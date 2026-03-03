import type { BpmWorkerResponse } from './bpm-detector.worker';

export interface BpmResult {
	bpm: number;
	/** Seconds offset to the first beat. */
	offset: number;
}

const TARGET_SAMPLE_RATE = 44100;

async function getMonoSamples(audioFile: File): Promise<Float32Array> {
	const arrayBuffer = await audioFile.arrayBuffer();
	const ctx = new AudioContext();
	try {
		const audioBuffer = await ctx.decodeAudioData(arrayBuffer);
		if (
			audioBuffer.sampleRate === TARGET_SAMPLE_RATE &&
			audioBuffer.numberOfChannels === 1
		) {
			return audioBuffer.getChannelData(0).slice();
		}
		// Resample + downmix to mono 44 100 Hz via OfflineAudioContext
		const offlineCtx = new OfflineAudioContext(
			1,
			Math.ceil(audioBuffer.duration * TARGET_SAMPLE_RATE),
			TARGET_SAMPLE_RATE,
		);
		const source = offlineCtx.createBufferSource();
		source.buffer = audioBuffer;
		source.connect(offlineCtx.destination);
		source.start(0);
		const resampled = await offlineCtx.startRendering();
		return resampled.getChannelData(0).slice();
	} finally {
		await ctx.close();
	}
}

export async function detectBpm(
	audioFile: File,
	signal?: AbortSignal,
): Promise<BpmResult> {
	if (signal?.aborted) throw new DOMException('Aborted', 'AbortError');

	// Audio decoding is fast and can stay on the main thread.
	const samples = await getMonoSamples(audioFile);
	if (signal?.aborted) throw new DOMException('Aborted', 'AbortError');

	// Hand off the heavy WASM computation to a worker so the UI stays responsive.
	return new Promise<BpmResult>((resolve, reject) => {
		const worker = new Worker(
			new URL('./bpm-detector.worker.ts', import.meta.url),
			{ type: 'module' },
		);

		const onAbort = () => {
			worker.terminate();
			reject(new DOMException('Aborted', 'AbortError'));
		};
		signal?.addEventListener('abort', onAbort, { once: true });

		worker.onmessage = (e: MessageEvent<BpmWorkerResponse>) => {
			signal?.removeEventListener('abort', onAbort);
			worker.terminate();
			if (e.data.ok) {
				resolve({ bpm: e.data.bpm, offset: e.data.offset });
			} else {
				reject(new Error(e.data.error));
			}
		};

		worker.onerror = (err) => {
			signal?.removeEventListener('abort', onAbort);
			worker.terminate();
			reject(err);
		};

		// Transfer the buffer so no copy is needed.
		worker.postMessage({ samples }, [samples.buffer]);
	});
}
