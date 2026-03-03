import { Essentia, EssentiaWASM } from 'essentia.js';

export interface BpmResult {
	bpm: number;
	/** Seconds offset to the first beat. */
	offset: number;
}

let essentiaPromise: Promise<InstanceType<typeof Essentia>> | null = null;

function getEssentia(): Promise<InstanceType<typeof Essentia>> {
	if (!essentiaPromise) {
		essentiaPromise = Promise.resolve(new Essentia(EssentiaWASM.EssentiaWASM));
	}
	return essentiaPromise;
}

const TARGET_SAMPLE_RATE = 44100;

async function normalizeAudioBuffer(audioBuffer: AudioBuffer): Promise<AudioBuffer> {
	if (audioBuffer.sampleRate === TARGET_SAMPLE_RATE && audioBuffer.numberOfChannels === 1) {
		return audioBuffer;
	}
	const duration = audioBuffer.duration;
	const offlineCtx = new OfflineAudioContext(
		1,
		Math.ceil(duration * TARGET_SAMPLE_RATE),
		TARGET_SAMPLE_RATE,
	);
	const source = offlineCtx.createBufferSource();
	source.buffer = audioBuffer;
	source.connect(offlineCtx.destination);
	source.start(0);
	return offlineCtx.startRendering();
}

export async function detectBpm(audioFile: File, signal?: AbortSignal): Promise<BpmResult> {
	const arrayBuffer = await audioFile.arrayBuffer();
	if (signal?.aborted) throw new DOMException('Aborted', 'AbortError');

	const ctx = new AudioContext();
	try {
		const audioBuffer = await ctx.decodeAudioData(arrayBuffer);
		if (signal?.aborted) throw new DOMException('Aborted', 'AbortError');

		const resampled = await normalizeAudioBuffer(audioBuffer);
		if (signal?.aborted) throw new DOMException('Aborted', 'AbortError');

		const essentia = await getEssentia();
		if (signal?.aborted) throw new DOMException('Aborted', 'AbortError');

		const monoSignal = essentia.audioBufferToMonoSignal(resampled);
		const vectorSignal = essentia.arrayToVector(monoSignal);
		const result = essentia.RhythmExtractor2013(vectorSignal);

		const ticks = essentia.vectorToArray(result.ticks);
		const offset = ticks.length > 0 ? ticks[0] : 0;

		return {
			bpm: Math.round(result.bpm * 10) / 10, // round to 1 decimal to avoid jitter in the UI
			offset,
		};
	} finally {
		await ctx.close();
	}
}
