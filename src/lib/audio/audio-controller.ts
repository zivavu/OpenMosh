import { getDefinition, type EffectInstance } from '../effects';
import { getLevelFromFrequencyRange } from './audio-utils';

export interface AudioGraphState {
	context: AudioContext;
	source: MediaElementAudioSourceNode;
	analyser: AnalyserNode;
	frequencyData: Uint8Array;
	sampleRate: number;
	binCount: number;
}

export function createAudioGraph(
	element: HTMLAudioElement | HTMLVideoElement,
): AudioGraphState {
	const ctx = new AudioContext();
	const source = ctx.createMediaElementSource(element);
	const analyser = ctx.createAnalyser();
	analyser.fftSize = 2048;
	source.connect(analyser);
	analyser.connect(ctx.destination);
	return {
		context: ctx,
		source,
		analyser,
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
	timeData: Uint8Array,
): number {
	analyser.getByteTimeDomainData(timeData);
	let sum = 0;
	for (let i = 0; i < timeData.length; i++) {
		const n = (timeData[i] - 128) / 128;
		sum += n * n;
	}
	return Math.min(1, Math.sqrt(sum / timeData.length));
}

export function applyVolumeLinksTick(
	effects: EffectInstance[],
	volumeLevel: number,
	frequencyData: Uint8Array | null,
	sampleRate: number,
	fftSize: number,
): void {
	for (const effect of effects) {
		const links = effect.volumeLinks;
		if (!links) continue;
		const def = getDefinition(effect.defId);
		if (!def) continue;
		for (const param of def.params) {
			if (param.type !== 'range') continue;
			const link = links[param.key];
			if (!link) continue;
			const level =
				link.freqMin != null &&
				link.freqMax != null &&
				frequencyData &&
				sampleRate > 0
					? getLevelFromFrequencyRange(
							frequencyData,
							sampleRate,
							fftSize,
							link.freqMin,
							link.freqMax,
						)
					: volumeLevel;
			const { min: pMin, max: pMax, step } = param;
			let value = link.min + level * (link.max - link.min);
			value = Math.max(pMin, Math.min(pMax, value));
			if (step > 0) {
				value = Math.round((value - pMin) / step) * step + pMin;
				value = Math.max(pMin, Math.min(pMax, value));
			}
			effect.values[param.key] = value;
		}
	}
}
