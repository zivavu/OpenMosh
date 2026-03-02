# Essentia.js BPM Detector Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Replace `web-audio-beat-detector` with `essentia.js` (`RhythmExtractor2013`) for accurate BPM detection.

**Architecture:** Swap out the single `bpm-detector.ts` file — lazy-load the Essentia WASM module on first call, resample audio to 44100 Hz (required by the algorithm), downmix to mono, run `RhythmExtractor2013`, and return the same `BpmResult` interface so no callers change.

**Tech Stack:** `essentia.js` (npm), `OfflineAudioContext` (Web Audio API) for resampling, Svelte 5 + Vite 8 + bun.

---

### Task 1: Swap the package

**Files:**
- Modify: `package.json`

**Step 1: Remove old package, install new one**

```bash
bun remove web-audio-beat-detector
bun add essentia.js
```

**Step 2: Verify install**

```bash
ls node_modules/essentia.js
```
Expected: directory exists with `dist/` inside.

**Step 3: Commit**

```bash
git add package.json bun.lock
git commit -m "chore: swap web-audio-beat-detector for essentia.js"
```

---

### Task 2: Rewrite bpm-detector.ts

**Files:**
- Modify: `src/lib/slideshow/bpm-detector.ts`

**Context:**
- `RhythmExtractor2013` requires the input signal to be at **44100 Hz** sample rate — resample with `OfflineAudioContext` if needed.
- `essentia.audioBufferToMonoSignal(buffer)` returns a `Float32Array`.
- `essentia.arrayToVector(float32Array)` converts it to Essentia's internal `VectorFloat`.
- `essentia.RhythmExtractor2013(vectorSignal)` returns `{ bpm, ticks, confidence, estimates, bpmIntervals }`.
- `ticks` is a `VectorFloat` — use `essentia.vectorToArray(result.ticks)` to get a `Float32Array`; index 0 is the first beat position in seconds (our `offset`).
- The WASM module must be lazy-loaded: import `EssentiaWASM` from `essentia.js/dist/essentia-wasm.umd.js` and `Essentia` from `essentia.js`. Cache both in module-level variables so they're only loaded once.
- Keep the same exported `BpmResult` interface and `detectBpm(audioFile, signal?)` signature.

**Step 1: Rewrite the file**

Replace the entire contents of `src/lib/slideshow/bpm-detector.ts` with:

```typescript
import Essentia from 'essentia.js';
import EssentiaWASM from 'essentia.js/dist/essentia-wasm.umd.js';

export interface BpmResult {
	bpm: number;
	/** Seconds offset to the first beat. */
	offset: number;
}

let essentiaInstance: InstanceType<typeof Essentia> | null = null;

async function getEssentia(): Promise<InstanceType<typeof Essentia>> {
	if (!essentiaInstance) {
		const wasmModule = await EssentiaWASM();
		essentiaInstance = new Essentia(wasmModule);
	}
	return essentiaInstance;
}

const TARGET_SAMPLE_RATE = 44100;

async function resampleToMono(audioBuffer: AudioBuffer): Promise<AudioBuffer> {
	if (audioBuffer.sampleRate === TARGET_SAMPLE_RATE && audioBuffer.numberOfChannels === 1) {
		return audioBuffer;
	}
	const duration = audioBuffer.duration;
	const offlineCtx = new OfflineAudioContext(1, Math.ceil(duration * TARGET_SAMPLE_RATE), TARGET_SAMPLE_RATE);
	const source = offlineCtx.createBufferSource();
	source.buffer = audioBuffer;
	source.connect(offlineCtx.destination);
	source.start(0);
	return offlineCtx.startRendering();
}

export async function detectBpm(
	audioFile: File,
	signal?: AbortSignal,
): Promise<BpmResult> {
	const arrayBuffer = await audioFile.arrayBuffer();
	if (signal?.aborted) throw new DOMException('Aborted', 'AbortError');

	const ctx = new AudioContext();
	try {
		const audioBuffer = await ctx.decodeAudioData(arrayBuffer);
		if (signal?.aborted) throw new DOMException('Aborted', 'AbortError');

		const resampled = await resampleToMono(audioBuffer);
		if (signal?.aborted) throw new DOMException('Aborted', 'AbortError');

		const essentia = await getEssentia();
		if (signal?.aborted) throw new DOMException('Aborted', 'AbortError');

		const monoSignal = essentia.audioBufferToMonoSignal(resampled);
		const vectorSignal = essentia.arrayToVector(monoSignal);
		const result = essentia.RhythmExtractor2013(vectorSignal);

		const ticks = essentia.vectorToArray(result.ticks);
		const offset = ticks.length > 0 ? ticks[0] : 0;

		return {
			bpm: Math.round(result.bpm * 10) / 10,
			offset,
		};
	} finally {
		await ctx.close();
	}
}
```

**Step 2: Check for TypeScript types**

Run:
```bash
bun run check 2>&1 | head -40
```

If there are type errors about missing types for `essentia.js` imports (no `@types/essentia.js`), add a declaration shim.

If you see errors like `Cannot find module 'essentia.js'` or `Cannot find module 'essentia.js/dist/essentia-wasm.umd.js'`, create `src/lib/slideshow/essentia-shims.d.ts`:

```typescript
declare module 'essentia.js' {
	export default class Essentia {
		constructor(wasmModule: any);
		audioBufferToMonoSignal(buffer: AudioBuffer): Float32Array;
		arrayToVector(array: Float32Array): any;
		vectorToArray(vector: any): Float32Array;
		RhythmExtractor2013(signal: any, maxTempo?: number, method?: string, minTempo?: number): {
			bpm: number;
			ticks: any;
			confidence: number;
			estimates: any;
			bpmIntervals: any;
		};
	}
}

declare module 'essentia.js/dist/essentia-wasm.umd.js' {
	const EssentiaWASM: () => Promise<any>;
	export default EssentiaWASM;
}
```

Re-run check:
```bash
bun run check 2>&1 | head -40
```
Expected: no errors related to bpm-detector or essentia.

**Step 3: Verify Vite can resolve the WASM import**

Run the dev server briefly and check the browser console for import errors:
```bash
bun run dev
```
Open the app, upload an audio file, trigger BPM detection. If Vite throws an error about the `.umd.js` file or WASM binary, you may need to add to `vite.config.ts`:

```typescript
optimizeDeps: {
  exclude: ['essentia.js']
}
```

**Step 4: Commit**

```bash
git add src/lib/slideshow/bpm-detector.ts src/lib/slideshow/essentia-shims.d.ts
git commit -m "feat: replace web-audio-beat-detector with essentia.js RhythmExtractor2013"
```

---

### Task 3: Manual smoke test

**No code changes — verification only.**

**Step 1: Run the dev server**
```bash
bun run dev
```

**Step 2: Test BPM detection**
- Open the app in the browser
- Upload an audio track with a known BPM (use a track you can verify against Tunebat or similar)
- Navigate to the slideshow section and trigger BPM detection
- Verify the returned BPM is close to the expected value (within ±2 BPM is excellent)

**Step 3: Test abort behavior**
- Start BPM detection and quickly navigate away / cancel
- Verify no console errors about `AbortError`

**Step 4: Test a second detection (cache hit)**
- Run BPM detection on a second file
- It should be noticeably faster (WASM already loaded, no re-init)
