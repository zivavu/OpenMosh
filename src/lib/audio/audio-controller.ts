export { applyVolumeLinksToEffects as applyVolumeLinksTick } from './audio-utils';

export interface AudioGraphState {
	context: AudioContext;
	source: MediaElementAudioSourceNode;
	/** Applied before the analyser so FFT/volume-link data sees the normalized signal. */
	normalizeGain: GainNode;
	analyser: AnalyserNode;
	gain: GainNode;
	frequencyData: Uint8Array;
	sampleRate: number;
	binCount: number;
}

export function createAudioGraph(
	element: HTMLAudioElement | HTMLVideoElement,
): AudioGraphState {
	const ctx = new AudioContext();
	const source = ctx.createMediaElementSource(element);
	const normalizeGain = ctx.createGain();
	const analyser = ctx.createAnalyser();
	analyser.fftSize = 2048;
	const gain = ctx.createGain();
	source.connect(normalizeGain);
	normalizeGain.connect(analyser);
	analyser.connect(gain);
	gain.connect(ctx.destination);
	return {
		context: ctx,
		source,
		normalizeGain,
		analyser,
		gain,
		frequencyData: new Uint8Array(analyser.frequencyBinCount),
		sampleRate: ctx.sampleRate,
		binCount: analyser.frequencyBinCount,
	};
}

export function disposeAudioGraph(state: AudioGraphState): void {
	state.context.close();
}

export function computeVolumeLevel(
	analyser: AnalyserNode,
	timeData: Uint8Array<ArrayBuffer>,
): number {
	analyser.getByteTimeDomainData(timeData);
	let sum = 0;
	for (let i = 0; i < timeData.length; i++) {
		const n = (timeData[i] - 128) / 128;
		sum += n * n;
	}
	return Math.min(1, Math.sqrt(sum / timeData.length));
}

