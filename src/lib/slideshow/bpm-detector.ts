import { guess } from 'web-audio-beat-detector';

export interface BpmResult {
	bpm: number;
	/** Seconds offset to the first beat. */
	offset: number;
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
		const result = await guess(audioBuffer);
		return {
			bpm: Math.round(result.bpm * 10) / 10,
			offset: result.offset,
		};
	} finally {
		await ctx.close();
	}
}
