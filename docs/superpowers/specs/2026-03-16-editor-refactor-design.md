# Editor Refactor Design

**Date:** 2026-03-16
**Status:** Approved

## Problem

`Editor.svelte` (1613 LOC) and `SlideshowEditor.svelte` (1203 LOC) are too large and share ~150 LOC of near-identical audio management code. There is no mechanism for reusing shared stateful logic between the two editors.

## Goal

- Significantly reduce both editor files (target: ~900 LOC for Editor, ~700 LOC for SlideshowEditor)
- Eliminate the duplicated audio management code
- Extract a shared `TrackAddBar` UI component
- Leave all editor-specific logic in place (video, history, mosh, BPM, preview loop)
- No behaviour changes — pure refactor

---

## What Gets Extracted

### 1. `src/lib/audio/audio-manager.svelte.ts`

A Svelte 5 rune-based class that encapsulates all audio state and behaviour shared by both editors. Uses `$state`, `$derived`, and `$effect` directly in a `.svelte.ts` file.

**Constructor signature:**

```ts
class AudioManager {
  constructor(options: {
    getEffects: () => EffectInstance[];
    initialOutputVolume?: number;
  })
}
```

`getEffects` is a callback that reads the editor's `effects` `$state` variable each frame: `() => effects`. Because `effects` is a Svelte 5 `$state` proxy, reassigning `effects` in the editor replaces the reference that the closure reads — the callback always returns the current value.

**`audioEl` binding pattern:** Svelte 5's `bind:this` only accepts locally-declared variables as its target — it does not support property-access expressions like `manager.audioEl`. The correct pattern is:

```ts
// In the editor script:
let audioEl = $state<HTMLAudioElement | undefined>(undefined);
$effect(() => { manager.setAudioEl(audioEl); });
```

`manager.setAudioEl(el)` is a public method that updates the manager's internal `audioEl` state and is called whenever the local binding changes.

**Public state (readable from editor templates):**

```ts
trackFile: File | null
trackObjectUrl: string | null     // internal $effect: creates ObjectURL on trackFile change, revokes on cleanup
trackDuration: number
trackCurrentTime: number
spanStart: number
spanEnd: number
audioPlaying: boolean
pendingSpan: { start: number; end: number } | null
volumeLevel: number
frequencyData: Uint8Array | null
audioSampleRate: number
audioFrequencyBinCount: number
audioContext: AudioContext | null
analyserNode: AnalyserNode | null
gainNode: GainNode | null
normalizeGainNode: GainNode | null
outputVolume: number
mediaSource: MediaElementAudioSourceNode | null
spectrumData: SpectrumData | null   // $derived — see note below
```

**`spectrumData` shape:** The unified `SpectrumData` type (in `src/lib/types/index.ts`) gains an optional `tick` field:
```ts
interface SpectrumData {
  data: Uint8Array;
  sampleRate: number;
  binCount: number;
  tick?: number;   // volumeLevel tick, used by SlideshowEditor spectrum display
}
```
The manager always sets `tick: volumeLevel` in the derived value. Editor.svelte currently omits `tick` — this is a safe additive change; no existing consumer breaks.

**Methods:**

```ts
setAudioEl(el: HTMLAudioElement | undefined): void
ensureAudioGraph(): void
applyAudioGraphState(state: AudioGraphState): void   // used by Editor for video audio graph
disposeAudioGraph(): void
onAudioLoadedMetadata(): void
onAudioTimeUpdate(): void
playAudio(): void
pauseAudio(): void
seekTo(t: number): void
clearTrack(): void
setOutputVolume(v: number): void
```

**`pendingSpan` shape — unified to `{ start: number; end: number }`.** Both the setter site (`onLibraryLoadTrack`) and the reader site (`onAudioLoadedMetadata`) use this shape. `onAudioLoadedMetadata` inside the manager reads `pendingSpan.start` and `pendingSpan.end`. As part of this refactor, `Editor.svelte`'s `onLibraryLoadTrack` must be updated to write `pendingSpan = { start: saved.spanStart, end: saved.spanEnd }` (the old Editor shape was `{ spanStart, spanEnd }`).

**`applyAudioGraphState`** applies a `AudioGraphState` returned by `createAudioGraph()` to the manager's internal state fields. It does not set `normalizeGainNode.gain.value` — that is the responsibility of the caller (Editor.svelte), which has access to its local `normalizeGain` state:
```ts
manager.applyAudioGraphState(state);
if (manager.normalizeGainNode) manager.normalizeGainNode.gain.value = normalizeGain;
```

**`$effects` owned by the manager:**
- ObjectURL lifecycle for `trackObjectUrl` (creates on `trackFile` change, revokes on cleanup)
- rAF loop for `volumeLevel` + `frequencyData` + `applyVolumeLinksTick` — runs when `analyserNode` is set; calls `getEffects()` each frame. Note: `frequencyData` and `sampleRate` are captured in the closure at effect-run time (preserved behavior from the original code — not a regression).

**The `trackCurrentTime` rAF smoothing loop** (currently in SlideshowEditor only) stays in `SlideshowEditor.svelte`. `Editor.svelte` continues to rely on the `ontimeupdate` DOM event, preserving existing behavior in both editors.

**`outputVolume` persistence:**
- `Editor.svelte` persists `outputVolume` inside `saveSettings()`. After extraction it reads `manager.outputVolume` (public readable state).
- `SlideshowEditor.svelte` passes its persisted `outputVolume` to the manager constructor: it calls `loadConfig()` before constructing the manager and passes `initialOutputVolume: loadConfig().outputVolume ?? 1`. The `$effect` that saves config reads `manager.outputVolume`.

**`Editor.svelte` additions on top of the manager:**
- `normalizeGain` local state and wiring: after `manager.applyAudioGraphState(state)`, Editor sets `manager.normalizeGainNode!.gain.value = normalizeGain`
- `ensureVideoAudioGraph()`: calls `createAudioGraph(videoEl)` then `manager.applyAudioGraphState(state)` + sets normalizeGain
- `onLibraryLoadTrack` calls `manager.clearTrack()` then resets `normalizeGain = 1.0`

**`SlideshowEditor.svelte` additions on top of the manager:**
- Nothing extra — uses the manager as-is

---

### 2. `src/lib/effects/index.ts` — add `setVolumeLink` utility

`setVolumeLink` has no dependency on audio state — it only transforms `EffectInstance.volumeLinks`. It is extracted as a standalone pure utility function:

```ts
export function setVolumeLink(
  effects: EffectInstance[],
  index: number,
  paramKey: string,
  link: VolumeLink | null,
): EffectInstance[]
```

Each editor calls this and applies the returned array to its own `effects` state.

---

### 3. `src/lib/components/ui/TrackAddBar.svelte`

Extracts the "Add audio track" button + music hint callout.

**Props:**

```ts
interface Props {
  onOpenPicker: () => void;
  hintText?: string;  // defaults to "Add music to sync transitions to the beat"
}
```

The hint text differs between editors:
- `Editor.svelte`: "Add music to make effects react to the beat"
- `SlideshowEditor.svelte`: "Add music to sync transitions to the beat"

The `hintText` prop handles this. The localStorage key `openmosh-music-hint-dismissed` is shared — dismissing in one editor dismisses in both (current behavior preserved).

**Internal state:** `showMusicHint` reads/writes `localStorage`. The component only renders inside `{#if !audio.trackFile}` in both editors, so the hint naturally disappears when a track is loaded — no `trackLoaded` prop needed.

Styles move from both editor files into this component.

---

## What Stays in the Editor Files

| Concern | Editor.svelte | SlideshowEditor.svelte |
|---|---|---|
| `effects` state | ✓ | ✓ |
| `setVolumeLink` call (via util) | ✓ | ✓ |
| Recording state + orchestration | ✓ | ✓ |
| History / undo / redo | ✓ | – |
| Mosh settings | ✓ | – |
| Format / FPS | ✓ | ✓ |
| Video state + `videoEl` | ✓ | – |
| `normalizeGain` + video audio graph | ✓ | – |
| Keyboard handler | ✓ | ✓ |
| `trackCurrentTime` rAF loop | – | ✓ |
| Slideshow preview loop | – | ✓ |
| BPM detection | – | ✓ |
| Slides / presets / config | – | ✓ |
| `AudioManager` instance | ✓ | ✓ |
| `<TrackAddBar>` usage | ✓ | ✓ |
| Local `audioEl` binding + `$effect` sync to manager | ✓ | ✓ |

---

## File Size Estimates After Refactor

| File | Before | Estimated After |
|---|---|---|
| `Editor.svelte` | 1613 LOC | ~900 LOC |
| `SlideshowEditor.svelte` | 1203 LOC | ~700 LOC |
| `audio-manager.svelte.ts` | – | ~220 LOC |
| `TrackAddBar.svelte` | – | ~80 LOC |
| `src/lib/types/index.ts` | ~6 LOC | ~12 LOC |
| `src/lib/effects/index.ts` | existing | +~15 LOC |

---

## Constraints

- Svelte 5 runes only — `$state`, `$derived`, `$effect` in `.svelte.ts` files
- No new external dependencies
- No behaviour changes (minor additive: `tick?` on `SpectrumData`)
- `AudioManager` is instantiated once per editor component lifecycle; it is not a singleton
- `audioEl` is bound locally in the editor, then synced to the manager via `$effect(() => { manager.setAudioEl(audioEl); })`
- `setVolumeLink` is a pure utility in `src/lib/effects/index.ts`, not a method on `AudioManager`

---

## Out of Scope

- Further splitting `Editor.svelte` beyond what's described
- Svelte stores or context API
- Any UI or behaviour changes beyond the minor `SpectrumData.tick?` addition
