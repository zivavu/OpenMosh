# Editor Refactor Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Extract shared audio management logic from Editor.svelte and SlideshowEditor.svelte into a reusable `AudioManager` rune class, a `setVolumeLink` utility, and a `TrackAddBar` component.

**Architecture:** A Svelte 5 `.svelte.ts` rune class (`AudioManager`) owns all audio state (`trackFile`, `audioEl`, `audioContext`, `analyserNode`, `gainNode`, spans, volume, spectrum data) and methods (`playAudio`, `pauseAudio`, `seekTo`, `clearTrack`, etc.). Both editors instantiate one manager each and delegate to it. A pure utility function `setVolumeLink` in `effects/index.ts` replaces the identical copy in each editor. A new `TrackAddBar.svelte` component replaces the duplicated "Add audio track" button + hint callout markup.

**Tech Stack:** Svelte 5 runes (`$state`, `$derived`, `$effect`), TypeScript, bun

---

## File Map

| Action | Path | Responsibility |
|--------|------|----------------|
| Create | `src/lib/audio/audio-manager.svelte.ts` | All shared audio state + methods |
| Modify | `src/lib/effects/index.ts` | Add `setVolumeLink` pure utility |
| Create | `src/lib/components/ui/TrackAddBar.svelte` | "Add audio track" button + music hint callout |
| Modify | `src/lib/components/editor/Editor.svelte` | Use AudioManager, setVolumeLink, TrackAddBar |
| Modify | `src/lib/components/slideshow/SlideshowEditor.svelte` | Use AudioManager, setVolumeLink, TrackAddBar |

`src/lib/types/index.ts` — `tick?` already exists on `SpectrumData`; no change needed.

---

## Chunk 1: Foundation — AudioManager + setVolumeLink utility

### Task 1: Add `setVolumeLink` utility to `src/lib/effects/index.ts`

**Files:**
- Modify: `src/lib/effects/index.ts`

The existing per-editor implementation (identical in both editors):
```ts
// Editor.svelte lines 480-495 / SlideshowEditor.svelte lines 222-239
function setVolumeLink(index, paramKey, link) {
  const e = effects[index];
  const nextLinks = e.volumeLinks ? { ...e.volumeLinks } : {};
  if (link === null) { delete nextLinks[paramKey]; } else { nextLinks[paramKey] = link; }
  effects = effects.map((eff, i) => i === index ? { ...eff, volumeLinks: nextLinks } : eff);
}
```

- [ ] **Step 1.1: Add the pure utility function**

Open `src/lib/effects/index.ts` and append after the last export:

```ts
export function setVolumeLink(
  effects: EffectInstance[],
  index: number,
  paramKey: string,
  link: VolumeLink | null,
): EffectInstance[] {
  const e = effects[index];
  const nextLinks = e.volumeLinks ? { ...e.volumeLinks } : {};
  if (link === null) {
    delete nextLinks[paramKey];
  } else {
    nextLinks[paramKey] = link;
  }
  return effects.map((eff, i) =>
    i === index ? { ...eff, volumeLinks: nextLinks } : eff,
  );
}
```

`VolumeLink` is already exported from `./types` via the `export * from "./types"` at the top of the file.

- [ ] **Step 1.2: Verify type-check passes**

```bash
cd c:/Users/zivavu/Desktop/code/OpenMosh && bun run check
```

Expected: no new errors.

- [ ] **Step 1.3: Commit**

```bash
git add src/lib/effects/index.ts
git commit -m "Add setVolumeLink pure utility to effects/index"
```

---

### Task 2: Create `src/lib/audio/audio-manager.svelte.ts`

**Files:**
- Create: `src/lib/audio/audio-manager.svelte.ts`

This class owns all the audio state that is currently duplicated between the two editors. Read `src/lib/audio/audio-controller.ts` for the `createAudioGraph`, `disposeAudioGraph`, `computeVolumeLevel`, `AudioGraphState` exports, and `src/lib/audio/audio-utils.ts` for `applyVolumeLinksToEffects` (re-exported as `applyVolumeLinksTick` from audio-controller).

- [ ] **Step 2.1: Create the file**

Create `src/lib/audio/audio-manager.svelte.ts` with this full content:

```ts
import {
  createAudioGraph,
  disposeAudioGraph as disposeGraph,
  computeVolumeLevel,
  applyVolumeLinksTick,
  type AudioGraphState,
} from './audio-controller';
import type { EffectInstance } from '../effects';
import type { SpectrumData } from '../types';

interface AudioManagerOptions {
  getEffects: () => EffectInstance[];
  initialOutputVolume?: number;
}

export class AudioManager {
  // ── Track file ──
  trackFile = $state<File | null>(null);
  trackObjectUrl = $state<string | null>(null);

  // ── Audio element (set by editor via setAudioEl) ──
  #audioEl = $state<HTMLAudioElement | undefined>(undefined);

  // ── Playback ──
  trackDuration = $state(0);
  trackCurrentTime = $state(0);
  spanStart = $state(0);
  spanEnd = $state(0);
  audioPlaying = $state(false);
  pendingSpan = $state<{ start: number; end: number } | null>(null);

  // ── Audio graph ──
  audioContext = $state<AudioContext | null>(null);
  analyserNode = $state<AnalyserNode | null>(null);
  gainNode = $state<GainNode | null>(null);
  normalizeGainNode = $state<GainNode | null>(null);
  mediaSource = $state<MediaElementAudioSourceNode | null>(null);

  // ── Frequency / volume ──
  volumeLevel = $state(0);
  frequencyData = $state<Uint8Array | null>(null);
  audioSampleRate = $state(0);
  audioFrequencyBinCount = $state(0);
  outputVolume = $state(1);

  // ── Derived ──
  spectrumData: SpectrumData | null = $derived(
    this.frequencyData && this.audioSampleRate > 0 && this.audioFrequencyBinCount > 0
      ? {
          data: this.frequencyData,
          sampleRate: this.audioSampleRate,
          binCount: this.audioFrequencyBinCount,
          tick: this.volumeLevel,
        }
      : null,
  );

  readonly #getEffects: () => EffectInstance[];

  constructor({ getEffects, initialOutputVolume = 1 }: AudioManagerOptions) {
    this.#getEffects = getEffects;
    this.outputVolume = initialOutputVolume;

    // ObjectURL lifecycle
    $effect(() => {
      const f = this.trackFile;
      if (!f) {
        this.trackObjectUrl = null;
        return;
      }
      const url = URL.createObjectURL(f);
      this.trackObjectUrl = url;
      return () => URL.revokeObjectURL(url);
    });

    // Volume / frequency rAF tick
    $effect(() => {
      const analyser = this.analyserNode;
      if (!analyser) return;
      const timeData = new Uint8Array(analyser.fftSize);
      // Capture at effect-run time (preserved behavior from original editors)
      const freqDataRef = this.frequencyData;
      const sampleRate = this.audioSampleRate;
      const fftSize = analyser.fftSize;
      let rafId: number;
      const tick = () => {
        this.volumeLevel = computeVolumeLevel(analyser, timeData);
        if (freqDataRef)
          analyser.getByteFrequencyData(freqDataRef as Uint8Array<ArrayBuffer>);
        applyVolumeLinksTick(
          this.#getEffects(),
          this.volumeLevel,
          freqDataRef,
          sampleRate,
          fftSize,
        );
        rafId = requestAnimationFrame(tick);
      };
      rafId = requestAnimationFrame(tick);
      return () => cancelAnimationFrame(rafId);
    });
  }

  setAudioEl(el: HTMLAudioElement | undefined) {
    this.#audioEl = el;
  }

  ensureAudioGraph() {
    if (!this.#audioEl || this.audioContext) return;
    this.applyAudioGraphState(createAudioGraph(this.#audioEl));
  }

  applyAudioGraphState(state: AudioGraphState) {
    this.audioContext = state.context;
    this.mediaSource = state.source;
    this.normalizeGainNode = state.normalizeGain;
    this.analyserNode = state.analyser;
    this.gainNode = state.gain;
    this.gainNode.gain.value = this.outputVolume;
    this.frequencyData = state.frequencyData;
    this.audioSampleRate = state.sampleRate;
    this.audioFrequencyBinCount = state.binCount;
  }

  disposeAudioGraph() {
    if (this.audioContext) {
      disposeGraph({
        context: this.audioContext,
        source: this.mediaSource!,
        normalizeGain: this.normalizeGainNode!,
        analyser: this.analyserNode!,
        gain: this.gainNode!,
        frequencyData: this.frequencyData!,
        sampleRate: this.audioSampleRate,
        binCount: this.audioFrequencyBinCount,
      });
    }
    this.mediaSource = null;
    this.normalizeGainNode = null;
    this.analyserNode = null;
    this.gainNode = null;
    this.frequencyData = null;
    this.audioSampleRate = 0;
    this.audioFrequencyBinCount = 0;
    this.audioContext = null;
    this.volumeLevel = 0;
  }

  onAudioLoadedMetadata() {
    const d = this.#audioEl?.duration;
    if (typeof d === 'number' && Number.isFinite(d)) {
      this.trackDuration = d;
      if (this.pendingSpan) {
        this.spanStart = Math.max(0, Math.min(this.pendingSpan.start, d));
        this.spanEnd = Math.max(0, Math.min(this.pendingSpan.end, d));
        this.pendingSpan = null;
      } else {
        this.spanStart = 0;
        this.spanEnd = d;
      }
    }
  }

  onAudioTimeUpdate() {
    if (!this.#audioEl) return;
    this.trackCurrentTime = this.#audioEl.currentTime;
    if (this.audioPlaying && this.#audioEl.currentTime >= this.spanEnd) {
      this.#audioEl.pause();
      this.#audioEl.currentTime = this.spanStart;
      this.trackCurrentTime = this.spanStart;
      this.audioPlaying = false;
    }
  }

  playAudio() {
    if (!this.trackFile || !this.trackObjectUrl || !this.#audioEl) return;
    this.ensureAudioGraph();
    if (this.audioContext?.state === 'suspended') this.audioContext.resume();
    const t = this.#audioEl.currentTime;
    if (t < this.spanStart || t >= this.spanEnd) {
      this.#audioEl.currentTime = this.spanStart;
      this.trackCurrentTime = this.spanStart;
    }
    this.#audioEl.play();
    this.audioPlaying = true;
  }

  pauseAudio() {
    this.#audioEl?.pause();
    this.audioPlaying = false;
  }

  seekTo(t: number) {
    if (!this.#audioEl) return;
    const clamped = Math.max(0, Math.min(this.trackDuration, t));
    this.#audioEl.currentTime = clamped;
    this.trackCurrentTime = clamped;
  }

  clearTrack() {
    this.#audioEl?.pause();
    this.audioPlaying = false;
    this.trackFile = null;
    this.trackDuration = 0;
    this.trackCurrentTime = 0;
    this.spanStart = 0;
    this.spanEnd = 0;
    this.pendingSpan = null;
    this.disposeAudioGraph();
  }

  setOutputVolume(v: number) {
    this.outputVolume = v;
    if (this.gainNode) this.gainNode.gain.value = v;
  }
}
```

- [ ] **Step 2.2: Verify type-check passes**

```bash
cd c:/Users/zivavu/Desktop/code/OpenMosh && bun run check
```

Expected: no new errors.

- [ ] **Step 2.3: Commit**

```bash
git add src/lib/audio/audio-manager.svelte.ts
git commit -m "Add AudioManager rune class"
```

---

### Task 3: Create `src/lib/components/ui/TrackAddBar.svelte`

**Files:**
- Create: `src/lib/components/ui/TrackAddBar.svelte`

This replaces the duplicated "Add audio track" button + music hint callout in both editors. The two editors use slightly different hint text, so a `hintText` prop is used.

- [ ] **Step 3.1: Create the file**

Create `src/lib/components/ui/TrackAddBar.svelte` with this content:

```svelte
<script lang="ts">
  import { Music } from 'lucide-svelte';

  interface Props {
    onOpenPicker: () => void;
    hintText?: string;
  }

  let {
    onOpenPicker,
    hintText = 'Add music to sync transitions to the beat',
  }: Props = $props();

  const MUSIC_HINT_KEY = 'openmosh-music-hint-dismissed';

  let showMusicHint = $state(!localStorage.getItem(MUSIC_HINT_KEY));

  function dismissMusicHint() {
    localStorage.setItem(MUSIC_HINT_KEY, '1');
    showMusicHint = false;
  }
</script>

<div class="track-add-bar">
  <button class="track-add-btn" onclick={onOpenPicker}>
    <Music size={14} />
    Add audio track
  </button>
</div>
{#if showMusicHint}
  <div class="music-hint-callout">
    <span>{hintText}</span>
    <button
      class="music-hint-dismiss"
      onclick={dismissMusicHint}
      aria-label="Dismiss">&#x2715;</button
    >
  </div>
{/if}

<style>
  .track-add-bar {
    flex-shrink: 0;
    display: flex;
    align-items: center;
    padding: 0.35rem 0.75rem;
    background: rgba(18, 18, 18, 0.9);
    border-top: 1px solid #2a2a2a;
  }

  .track-add-btn {
    display: inline-flex;
    align-items: center;
    gap: 0.4rem;
    padding: 0.3rem 0.7rem;
    font-size: 0.65rem;
    font-weight: 600;
    letter-spacing: 0.05em;
    font-family: inherit;
    background: none;
    border: 1px solid #333;
    border-radius: 5px;
    color: #666;
    cursor: pointer;
    transition:
      color 0.15s,
      border-color 0.15s;
  }

  .track-add-btn:hover {
    color: #aaa;
    border-color: #555;
  }

  .music-hint-callout {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 0.5rem;
    padding: 0.4rem 0.75rem;
    background: rgba(255, 255, 255, 0.02);
    border-top: 1px solid #222;
    font-size: 0.68rem;
    color: #555;
    line-height: 1.4;
    flex-shrink: 0;
  }

  .music-hint-dismiss {
    background: none;
    border: none;
    color: #444;
    cursor: pointer;
    font-size: 0.7rem;
    padding: 0;
    flex-shrink: 0;
    line-height: 1;
  }

  .music-hint-dismiss:hover {
    color: #888;
  }
</style>
```

- [ ] **Step 3.2: Verify type-check passes**

```bash
cd c:/Users/zivavu/Desktop/code/OpenMosh && bun run check
```

Expected: no new errors.

- [ ] **Step 3.3: Commit**

```bash
git add src/lib/components/ui/TrackAddBar.svelte
git commit -m "Add TrackAddBar component"
```

---

## Chunk 2: Wire AudioManager into SlideshowEditor.svelte

SlideshowEditor is simpler (no video, no normalizeGain) so it's the better first integration target.

### Task 4: Replace audio logic in `SlideshowEditor.svelte`

**Files:**
- Modify: `src/lib/components/slideshow/SlideshowEditor.svelte`

Read the current file in full before making changes. The sections to replace are:

- All audio `$state` declarations (lines ~272–333): `trackFile`, `trackObjectUrl`, `trackInput`, `audioEl`, `trackDuration`, `trackCurrentTime`, `spanStart`, `spanEnd`, `audioPlaying`, `pendingSpan`, `volumeLevel`, `frequencyData`, `audioSampleRate`, `audioFrequencyBinCount`, `audioContext`, `analyserNode`, `gainNode`, `normalizeGainNode`, `outputVolume`, `mediaSource`
- `onAudioLoadedMetadata`, `onAudioTimeUpdate` functions
- `ensureAudioGraph`, `disposeAudioGraph` functions
- `playAudio`, `pauseAudio`, `seekTo` functions
- `clearTrack`, `onTrackInputChange`, `openTrackPicker` functions
- `onLibraryLoadTrack` (partial — keep slideshow-specific logic, delegate audio parts)
- The `$effect` for audio volume/frequency rAF tick (~lines 492–517)
- The `$effect` for `trackObjectUrl` lifecycle
- The two `$effect`s for `initialAudioFile` and music hint
- `spectrumData` `$derived`
- The `setVolumeLink` function
- `showMusicHint`, `dismissMusicHint`

The `trackCurrentTime` rAF smoothing loop (lines ~361–370) stays — it is SlideshowEditor-specific.

- [ ] **Step 4.1: Update imports at top of SlideshowEditor.svelte**

Replace the existing import block with these additions (keep all existing imports, add the new ones):

```ts
import { AudioManager } from '../../audio/audio-manager.svelte';
import { setVolumeLink } from '../../effects';
import TrackAddBar from '../ui/TrackAddBar.svelte';
```

Remove the now-unused imports:
- `applyVolumeLinksTick` (from audio-controller)
- `computeVolumeLevel` (from audio-controller)
- `createAudioGraph` (from audio-controller)
- `disposeAudioGraph as disposeAudioGraphState` (from audio-controller)
- `type VolumeLink` (from effects — still needed for setVolumeLink call site? No — `setVolumeLink` is now imported from effects, VolumeLink type is used in the onVolumeLinkChange prop signature in EffectsPanel — keep it)

- [ ] **Step 4.2: Instantiate AudioManager, remove duplicated state**

Remove the `outputVolume` `$state` declaration and all the audio state variables listed above. Replace with:

```ts
// Load outputVolume from config before constructing manager
const savedOutputVolume =
  ((loadConfig() as unknown as Record<string, unknown>).outputVolume as number) ?? 1;

const audio = new AudioManager({
  getEffects: () => effects,
  initialOutputVolume: savedOutputVolume,
});

// Sync audioEl DOM binding into the manager
let audioEl = $state<HTMLAudioElement | undefined>(undefined);
$effect(() => { audio.setAudioEl(audioEl); });

// Seed track from audio selected on the upload screen
$effect(() => {
  if (initialAudioFile && !audio.trackFile) {
    audio.trackFile = initialAudioFile;
  }
});
```

- [ ] **Step 4.3: Replace `openTrackPicker` / `onTrackInputChange` / `clearTrack`**

```ts
let trackInput: HTMLInputElement;

function openTrackPicker() {
  trackInput?.click();
}

function onTrackInputChange() {
  const f = trackInput?.files?.[0];
  if (f) {
    audio.trackFile = f;
    trackInput.value = '';
  }
}

function clearTrack() {
  audio.clearTrack();
  currentTrackId = null;
}
```

- [ ] **Step 4.4: Replace `onLibraryLoadTrack`**

The existing function does a **partial reset** — it intentionally does NOT zero `trackDuration` or `trackFile` so the AudioTimeline stays mounted during the switch (avoids a remount flash). Do not use `audio.clearTrack()` here — that zeros everything. Instead call the audio operations individually:

```ts
function onLibraryLoadTrack(file: File, trackId: string) {
  stopPreview();
  if (currentTrackId) saveSegments(currentTrackId);
  // Partial audio reset — intentionally skip zeroing trackDuration and trackFile
  // so AudioTimeline stays mounted during the switch (avoids a remount flash).
  audio.pauseAudio();
  audio.trackCurrentTime = 0;
  audio.spanStart = 0;
  audio.spanEnd = 0;
  audio.pendingSpan = null;
  currentTrackId = null;
  audio.disposeAudioGraph();
  currentTrackId = trackId;
  audio.trackFile = file;
  const saved = loadSegments(trackId);
  if (saved !== null) {
    config = {
      ...config,
      segments: saved.segments,
      ...(saved.bpm !== undefined ? { bpm: saved.bpm } : {}),
      ...(saved.textOverlay !== undefined ? { textOverlay: saved.textOverlay } : {}),
    };
    if (saved.spanStart !== undefined && saved.spanEnd !== undefined) {
      audio.pendingSpan = { start: saved.spanStart, end: saved.spanEnd };
    }
  }
}
```

- [ ] **Step 4.5: Replace `setVolumeLink` function**

Remove the local `setVolumeLink` function. Replace all calls from:
```ts
onVolumeLinkChange={setVolumeLink}
```
to:
```ts
onVolumeLinkChange={(index, paramKey, link) => {
  effects = setVolumeLink(effects, index, paramKey, link);
}}
```

- [ ] **Step 4.6: Update the `$effect` that saves config (outputVolume reference)**

The existing effect (line ~164–169) references `outputVolume` directly. Update it to read from `audio.outputVolume`:

```ts
$effect(() => {
  localStorage.setItem(
    CONFIG_KEY,
    JSON.stringify({ ...config, outputVolume: audio.outputVolume }),
  );
});
```

- [ ] **Step 4.7: Update the span-persistence `$effect`**

```ts
$effect(() => {
  audio.spanStart;
  audio.spanEnd;
  if (currentTrackId) saveSegments(currentTrackId);
});
```

And update `saveSegments` to read `audio.spanStart` / `audio.spanEnd`:
```ts
function saveSegments(trackId: string) {
  try {
    const all = JSON.parse(localStorage.getItem(TRACK_SEGMENTS_KEY) ?? '{}');
    all[trackId] = {
      segments: config.segments,
      bpm: config.bpm,
      textOverlay: config.textOverlay,
      spanStart: audio.spanStart,
      spanEnd: audio.spanEnd,
    };
    localStorage.setItem(TRACK_SEGMENTS_KEY, JSON.stringify(all));
  } catch {}
}
```

- [ ] **Step 4.8: Update the preview loop to use `audio.*` references**

Also delete the rAF `trackCurrentTime` smoothing `$effect` (existing lines ~361–370). The manager's `onAudioTimeUpdate` handles the same update via the DOM `ontimeupdate` event:
```ts
// DELETE this entire $effect:
$effect(() => {
  if (!audioPlaying || !audioEl) return;
  let rafId: number;
  const tick = () => {
    if (audioEl) trackCurrentTime = audioEl.currentTime;
    rafId = requestAnimationFrame(tick);
  };
  rafId = requestAnimationFrame(tick);
  return () => cancelAnimationFrame(rafId);
});
```

In `startPreview()`, replace the audio-play block (existing lines ~620–629):
```ts
if (audio.trackFile) {
  audio.playAudio();
  selectedSegmentId = null;
}
```
`audio.playAudio()` handles span-clamp, resume, and `audioPlaying` flag internally. `selectedSegmentId = null` clears the selected segment highlight — this is SlideshowEditor-specific state not owned by the manager.

In `stopPreview()`, replace the audio-stop block (existing lines ~739–742):
```ts
if (audio.audioPlaying) {
  audio.pauseAudio();
}
```

In the `tick()` function inside `startPreview`, make these replacements:
- `if (audioEl && trackFile && audioPlaying)` → `if (audio.trackFile && audio.audioPlaying)`
- `t = audioEl.currentTime` → `t = audio.trackCurrentTime`
- `if (t >= spanEnd)` → `if (t >= audio.spanEnd)`
- `trackFile` guard elsewhere → `audio.trackFile`
- `audioPlaying` → `audio.audioPlaying`
- `spanStart` / `spanEnd` → `audio.spanStart` / `audio.spanEnd`

- [ ] **Step 4.9: Update `getMoshOptions`**

```ts
function getMoshOptions() {
  return {
    moshMin: config.moshMin,
    moshMax: config.moshMax,
    randomizeOrder: true,
    moshAudioLink: config.moshAudioLink,
    moshAudioLinkStrength: config.moshAudioLinkStrength,
    hasAudio: !!audio.trackFile && !!audio.audioContext,
    audioSampleRate: audio.audioSampleRate,
    frequencyData: audio.frequencyData,
  };
}
```

- [ ] **Step 4.10: Update `startRecording`**

Replace direct state reads with `audio.*`:
```ts
audioFile: audio.trackFile,   // was: trackFile
audioStart: audio.spanStart,  // was: spanStart
audioEnd: audio.spanEnd,      // was: spanEnd
```
Also update the `!trackFile` guard at the top:
```ts
if (!audio.trackFile) {
  alert('Please add an audio track for slideshow recording.');
  return;
}
```

- [ ] **Step 4.11: Update the template**

Replace the `<audio>` element binding:
```svelte
{#if audio.trackObjectUrl}
  <audio
    bind:this={audioEl}
    src={audio.trackObjectUrl}
    onloadedmetadata={() => audio.onAudioLoadedMetadata()}
    ontimeupdate={() => audio.onAudioTimeUpdate()}
    onplay={() => (audio.audioPlaying = true)}
    onpause={() => (audio.audioPlaying = false)}
    hidden
  ></audio>
{/if}
```

Replace the `<TrackLibrary>` prop references:
```svelte
<TrackLibrary
  bind:this={trackLibraryRef}
  activeTrackName={audio.trackFile?.name ?? null}
  onLoadTrack={onLibraryLoadTrack}
  onPreviewStart={() => audio.pauseAudio()}
  mainPlaying={audio.audioPlaying}
  pendingTrack={audio.trackFile}
/>
```

Replace the `{#if !trackFile}` / `{:else if trackFile && trackDuration > 0}` block with `<TrackAddBar>` and the `<AudioTimeline>`:
```svelte
{#if !audio.trackFile}
  <TrackAddBar
    onOpenPicker={openTrackPicker}
    hintText="Add music to sync transitions to the beat"
  />
{:else if audio.trackFile && audio.trackDuration > 0}
  <AudioTimeline
    trackDuration={audio.trackDuration}
    trackCurrentTime={audio.trackCurrentTime}
    spanStart={audio.spanStart}
    spanEnd={audio.spanEnd}
    audioPlaying={audio.audioPlaying}
    outputVolume={audio.outputVolume}
    {config}
    bind:selectedSegmentId
    {onConfigChange}
    onPlay={() => audio.playAudio()}
    onPause={() => audio.pauseAudio()}
    onSeek={(t) => audio.seekTo(t)}
    onSpanStartChange={(t) => (audio.spanStart = t)}
    onSpanEndChange={(t) => (audio.spanEnd = t)}
    onVolumeChange={(v) => audio.setOutputVolume(v)}
    onRemoveTrack={clearTrack}
  />
{/if}
```

Remove the `showMusicHint` / `dismissMusicHint` state and functions — they moved into `TrackAddBar`.

Also remove the `$effect` that auto-dismissed the hint when trackFile was set (existing lines ~289–293):
```ts
// DELETE this entire $effect:
$effect(() => {
  if (trackFile && showMusicHint) {
    dismissMusicHint();
  }
});
```

Update the `ondrop` handler — `trackFile` no longer exists as a local var. Replace `trackFile = first` with `audio.trackFile = first`:
```svelte
ondrop={(e) => {
  e.preventDefault();
  dragging = false;
  const files = e.dataTransfer?.files;
  if (!files || files.length === 0) return;
  const first = files[0];
  if (first.type.startsWith('audio/')) {
    clearTrack();
    audio.trackFile = first;
  } else {
    addFiles(files);
  }
}}
```

Update the `<SlideshowActionBar>` `{trackFile}` prop:
```svelte
trackFile={audio.trackFile}
```

Update `<SlideshowConfigPanel>`:
```svelte
hasTrack={!!audio.trackFile}
trackCurrentTime={audio.trackCurrentTime}
trackDuration={audio.trackDuration}
```

Update `<MobileSheet>` → `<EffectsPanel>`:
```svelte
spectrumData={audio.spectrumData}
```

Update `<RecordOverlay>` — no audio refs there, already uses `recording` / `recordProgress`.

Update `<SlideshowActionBar>`:
```svelte
trackFile={audio.trackFile}
recordDuration={audio.trackFile && audio.trackDuration > 0 ? audio.spanEnd - audio.spanStart : 5}
```
(The `recordDuration` was previously a `$derived` — move it inline or keep as a local `$derived` reading from `audio`.)

Update `svelte:window`:
```svelte
<svelte:window
  onkeydown={handleKeydown}
  onpointerdown={() => audio.audioContext?.resume()}
/>
```

Remove the old `music-hint-callout` and `music-hint-dismiss` CSS blocks from the `<style>` section — they now live in `TrackAddBar.svelte`. Also remove `track-add-bar` and `track-add-btn` CSS.

- [ ] **Step 4.12: Verify type-check passes**

```bash
cd c:/Users/zivavu/Desktop/code/OpenMosh && bun run check
```

Expected: no errors.

- [ ] **Step 4.13: Smoke test in browser**

```bash
bun dev
```

Open the app, go to slideshow mode, load images, load an audio track. Verify:
- Audio plays/pauses correctly
- Span handles drag correctly
- Volume slider works
- Removing track works
- "Add audio track" button appears when no track loaded
- Music hint appears and can be dismissed
- Preview plays in sync with audio
- BPM detection still works

- [ ] **Step 4.14: Commit**

```bash
git add src/lib/components/slideshow/SlideshowEditor.svelte
git commit -m "Wire AudioManager into SlideshowEditor"
```

---

## Chunk 3: Wire AudioManager into Editor.svelte

Editor.svelte is more complex: it has `normalizeGain`, video audio graph, history, and a different keyboard handler.

### Task 5: Replace audio logic in `Editor.svelte`

**Files:**
- Modify: `src/lib/components/editor/Editor.svelte`

Read the current file in full before making changes. The approach is the same as Task 4, with these differences:
- Keep `normalizeGain` as a local `$state` variable (not in manager)
- `ensureVideoAudioGraph()` calls `manager.applyAudioGraphState()` + sets `manager.normalizeGainNode.gain.value = normalizeGain`
- `onLibraryLoadTrack` resets `normalizeGain = 1.0` after `audio.clearTrack()`
- `onTrackInputChange` resets `normalizeGain = 1.0` on new file load

- [ ] **Step 5.1: Update imports**

Add:
```ts
import { AudioManager } from '../../audio/audio-manager.svelte';
import { setVolumeLink } from '../../effects';
import TrackAddBar from '../ui/TrackAddBar.svelte';
```

Replace the audio-controller import block. The old import is:
```ts
import {
  applyVolumeLinksTick,
  computeVolumeLevel,
  createAudioGraph,
  disposeAudioGraph as disposeAudioGraphState,
} from '../../audio/audio-controller';
```

Replace it with (keep only what Editor still needs — `createAudioGraph` for the video path):
```ts
import { createAudioGraph } from '../../audio/audio-controller';
```

- [ ] **Step 5.2: Instantiate AudioManager, remove duplicated state**

Remove all the audio state vars (same list as Task 4, plus `normalizeGain` stays). Replace with:

```ts
const audio = new AudioManager({
  getEffects: () => effects,
  initialOutputVolume: saved.outputVolume ?? 1,
});

let normalizeGain = $state(1.0);

// Sync audioEl DOM binding into the manager
let audioEl = $state<HTMLAudioElement | undefined>(undefined);
$effect(() => { audio.setAudioEl(audioEl); });

// Seed track from audio selected on the upload screen
$effect(() => {
  if (initialAudioFile && !audio.trackFile) {
    audio.trackFile = initialAudioFile;
  }
});
```

- [ ] **Step 5.3: Update `saveSettings` to read `audio.outputVolume`**

```ts
function saveSettings() {
  localStorage.setItem(
    SETTINGS_KEY,
    JSON.stringify({
      moshMin,
      moshMax,
      randomizeOrder,
      moshAudioLink,
      moshAudioLinkStrength,
      showFps,
      outputVolume: audio.outputVolume,
    }),
  );
}
```

Update the settings-save `$effect` to subscribe to `audio.outputVolume`:
```ts
$effect(() => {
  moshMin; moshMax; randomizeOrder; moshAudioLink; moshAudioLinkStrength; showFps;
  audio.outputVolume;
  saveSettings();
});
```

- [ ] **Step 5.4: Replace `openTrackPicker` / `onTrackInputChange` / `clearTrack`**

```ts
let trackInput: HTMLInputElement;

function openTrackPicker() {
  trackInput?.click();
}

function onTrackInputChange() {
  const f = trackInput?.files?.[0];
  if (f) {
    normalizeGain = 1.0;
    audio.trackFile = f;
    trackInput.value = '';
  }
}

function clearTrack() {
  audio.clearTrack();
  currentTrackId = null;
  normalizeGain = 1.0;
}
```

- [ ] **Step 5.5: Replace `onLibraryLoadTrack`**

```ts
function onLibraryLoadTrack(file: File, trackId: string) {
  clearTrack();
  currentTrackId = trackId;
  audio.trackFile = file;
  const savedSpan = loadSingleSpan(trackId);
  if (savedSpan !== null) {
    audio.pendingSpan = { start: savedSpan.spanStart, end: savedSpan.spanEnd };
  }
}
```

Note: `loadSingleSpan` returns `{ spanStart, spanEnd }` (old shape) — map to the unified shape here.

- [ ] **Step 5.6: Replace `ensureVideoAudioGraph`**

```ts
function ensureVideoAudioGraph() {
  if (!videoEl || audio.audioContext || audio.trackFile) return;
  videoEl.muted = false;
  const state = createAudioGraph(videoEl);
  audio.applyAudioGraphState(state);
  audio.normalizeGainNode!.gain.value = normalizeGain;
  audio.audioContext!.resume().catch(() => {});
}
```

`createAudioGraph` was kept in the audio-controller import in Step 5.1 for exactly this purpose.

- [ ] **Step 5.7: Replace `playSpan` / `pauseTrack` / `seekTo`**

```ts
function playSpan() {
  audio.playAudio();
  if (isVideo && videoEl) {
    if (videoEl.currentTime < videoSpanStart || videoEl.currentTime >= videoSpanEnd) {
      videoEl.currentTime = videoSpanStart;
    }
    videoEl.play().catch(() => {});
  }
}

function pauseTrack() {
  audio.pauseAudio();
  if (isVideo) videoEl?.pause();
}

function seekTo(t: number) {
  audio.seekTo(t);
}
```

- [ ] **Step 5.8: Replace `setVolumeLink` function and `spectrumData`**

Remove the local `setVolumeLink` function. In the `<EffectsPanel>` usage, replace:
```svelte
onVolumeLinkChange={setVolumeLink}
```
with:
```svelte
onVolumeLinkChange={(index, paramKey, link) => {
  effects = setVolumeLink(effects, index, paramKey, link);
}}
```

Remove the `spectrumData` assembly block (it's now `audio.spectrumData`). In `<EffectsPanel>`:
```svelte
spectrumData={frequencyData && audioSampleRate > 0
  ? { data: frequencyData as Uint8Array<ArrayBuffer>, sampleRate: audioSampleRate, binCount: audioFrequencyBinCount }
  : null}
```
Replace with:
```svelte
spectrumData={audio.spectrumData}
```

- [ ] **Step 5.9: Update `getMoshOptions`**

```ts
function getMoshOptions() {
  return {
    moshMin,
    moshMax,
    randomizeOrder,
    moshAudioLink,
    moshAudioLinkStrength,
    hasAudio: !!audio.trackFile && !!audio.audioContext,
    audioSampleRate: audio.audioSampleRate,
    frequencyData: audio.frequencyData,
  };
}
```

- [ ] **Step 5.10: Update span persistence `$effect`**

```ts
$effect(() => {
  audio.spanStart;
  audio.spanEnd;
  if (currentTrackId) saveSingleSpan(currentTrackId);
});
```

Update `saveSingleSpan` to read from manager:
```ts
function saveSingleSpan(trackId: string) {
  try {
    const all = JSON.parse(localStorage.getItem(SINGLE_SPAN_KEY) ?? '{}');
    all[trackId] = { spanStart: audio.spanStart, spanEnd: audio.spanEnd };
    localStorage.setItem(SINGLE_SPAN_KEY, JSON.stringify(all));
  } catch {}
}
```

- [ ] **Step 5.11: Update `startRecording`**

```ts
trackFile: audio.trackFile,
trackDuration: audio.trackDuration,
spanStart: audio.spanStart,
spanEnd: audio.spanEnd,
normalizeGain,
```

Update `effectiveDuration` derived:
```ts
let effectiveDuration = $derived(
  audio.trackFile && audio.trackDuration > 0 && audio.spanEnd - audio.spanStart > 0
    ? audio.spanEnd - audio.spanStart
    : isVideo && videoDuration > 0
      ? videoSpanEnd - videoSpanStart
      : recordDuration,
);
```

- [ ] **Step 5.12: Update keyboard handler**

```ts
const handleKeydown = createKeyboardHandler({
  save,
  mosh,
  undo,
  reInput,
  playSpan,
  pauseTrack,
  hasTrack: () => (!!audio.trackFile && !!audioEl) || isVideo,
  isPlaying: () => audio.audioPlaying || videoPlaying,
});
```

- [ ] **Step 5.13: Update the template**

Replace `<audio>` element:
```svelte
{#if audio.trackObjectUrl}
  <audio
    bind:this={audioEl}
    src={audio.trackObjectUrl}
    onloadedmetadata={() => audio.onAudioLoadedMetadata()}
    ontimeupdate={() => audio.onAudioTimeUpdate()}
    onplay={() => (audio.audioPlaying = true)}
    onpause={() => (audio.audioPlaying = false)}
    hidden
  ></audio>
{/if}
```

Replace `<TrackLibrary>`:
```svelte
<TrackLibrary
  bind:this={trackLibraryRef}
  activeTrackName={audio.trackFile?.name ?? null}
  activeTrackId={currentTrackId}
  onLoadTrack={onLibraryLoadTrack}
  onPreviewStart={() => audio.pauseAudio()}
  mainPlaying={audio.audioPlaying}
  pendingTrack={audio.trackFile}
  onNormalizeChange={(gain) => {
    normalizeGain = gain;
    if (audio.normalizeGainNode) audio.normalizeGainNode.gain.value = gain;
  }}
/>
```

Replace `{#if !trackFile}` and `{#if !trackFile && showMusicHint}` blocks with `<TrackAddBar>`:
```svelte
{#if !audio.trackFile}
  <TrackAddBar
    onOpenPicker={openTrackPicker}
    hintText="Add music to make effects react to the beat"
  />
{/if}
```

Replace `{#if trackFile && trackDuration > 0}` AudioTimeline:
```svelte
{#if audio.trackFile && audio.trackDuration > 0}
  <AudioTimeline
    trackDuration={audio.trackDuration}
    trackCurrentTime={audio.trackCurrentTime}
    spanStart={audio.spanStart}
    spanEnd={audio.spanEnd}
    audioPlaying={audio.audioPlaying}
    outputVolume={audio.outputVolume}
    onPlay={playSpan}
    onPause={pauseTrack}
    onSeek={seekTo}
    onSpanStartChange={(t) => (audio.spanStart = t)}
    onSpanEndChange={(t) => (audio.spanEnd = t)}
    onVolumeChange={(v) => audio.setOutputVolume(v)}
    onRemoveTrack={clearTrack}
  />
{/if}
```

Update video timeline's volume slider condition:
```svelte
{#if audio.analyserNode && !audio.trackFile}
  <input
    ...
    value={audio.outputVolume}
    oninput={(e) => {
      audio.setOutputVolume(+(e.currentTarget as HTMLInputElement).value);
    }}
    title="Output volume: {Math.round(audio.outputVolume * 100)}%"
  />
{/if}
```

Update `svelte:window`:
```svelte
<svelte:window
  onkeydown={handleKeydown}
  onpointerdown={(e) => {
    audio.audioContext?.resume();
    moshGroupRef?.handleClickOutside(e);
    recordGroupRef?.handleClickOutside(e);
  }}
/>
```

Update `<EffectsPanel>` `hasTrack` prop (existing template line ~1054). Old value referenced local `trackFile` and `analyserNode`:
```svelte
hasTrack={!!audio.trackFile || (isVideo && !!audio.analyserNode)}
```

Update the `ondrop` handler — `trackFile` no longer exists as a local var:
```svelte
ondrop={(e) => {
  e.preventDefault();
  dragging = false;
  const f = e.dataTransfer?.files[0];
  if (!f) return;
  if (f.type.startsWith('audio/')) {
    clearTrack();
    audio.trackFile = f;
  } else if (f.type.startsWith('image/') || f.type.startsWith('video/')) {
    onfile(f);
  }
}}
```

Also remove the auto-dismiss music hint `$effect` (existing lines ~192–196):
```ts
// DELETE this entire $effect:
$effect(() => {
  if (trackFile && showMusicHint) {
    dismissMusicHint();
  }
});
```
And remove the `showMusicHint` / `dismissMusicHint` state and functions.

Remove `music-hint-callout`, `music-hint-dismiss`, `track-add-bar`, `track-add-btn` CSS from `<style>` — they moved into `TrackAddBar.svelte`.

- [ ] **Step 5.14: Verify type-check passes**

```bash
cd c:/Users/zivavu/Desktop/code/OpenMosh && bun run check
```

Expected: no errors.

- [ ] **Step 5.15: Smoke test in browser**

```bash
bun dev
```

Open the app. Test single-image editor:
- Load an image, load an audio track
- Play/pause, seek, span handles drag
- Volume slider works
- Track library loads tracks with saved spans
- Normalize gain slider works
- Mosh + undo + clear work
- WebM recording completes
- Load a video, verify video audio graph works and volume slider appears
- Music hint appears with correct text ("make effects react to the beat") and can be dismissed

- [ ] **Step 5.16: Commit**

```bash
git add src/lib/components/editor/Editor.svelte
git commit -m "Wire AudioManager into Editor"
```

---

## Chunk 4: Cleanup

### Task 6: Remove dead code and verify final state

**Files:**
- Modify: `src/lib/components/editor/Editor.svelte` (remove dead CSS)
- Modify: `src/lib/components/slideshow/SlideshowEditor.svelte` (remove dead CSS)

- [ ] **Step 6.1: Verify no dead imports remain**

```bash
cd c:/Users/zivavu/Desktop/code/OpenMosh && bun run check
```

Fix any "unused import" warnings surfaced by the type-checker.

- [ ] **Step 6.2: Final smoke test**

```bash
bun dev
```

Test both editors end-to-end. Verify audio, volume, spans, recording, and UI hints all work as before.

- [ ] **Step 6.3: Commit**

```bash
git add src/lib/components/editor/Editor.svelte src/lib/components/slideshow/SlideshowEditor.svelte
git commit -m "Remove dead audio code after AudioManager extraction"
```
