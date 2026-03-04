import { getDefinition, type EffectInstance } from '../effects';

export function applyVolumeLinksToEffects(
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
			let level =
				link.freqMin != null && link.freqMax != null && frequencyData && sampleRate > 0
					? getLevelFromFrequencyRange(frequencyData, sampleRate, fftSize, link.freqMin, link.freqMax)
					: volumeLevel;
			if (link.inverted) level = 1 - level;
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

export function getLevelFromFrequencyRange(
	freqData: Uint8Array,
	sampleRate: number,
	fftSize: number,
	freqMin: number,
	freqMax: number,
): number {
	const binCount = freqData.length;
	const minBin = Math.max(0, Math.floor((freqMin / sampleRate) * fftSize));
	const maxBin = Math.min(
		binCount - 1,
		Math.ceil((freqMax / sampleRate) * fftSize),
	);
	if (minBin > maxBin) return 0;
	let sum = 0;
	for (let i = minBin; i <= maxBin; i++) sum += freqData[i];
	const count = maxBin - minBin + 1;
	return Math.min(1, sum / count / 255);
}

export function formatTime(sec: number): string {
	if (!Number.isFinite(sec) || sec < 0) return '0:00';
	const m = Math.floor(sec / 60);
	const s = Math.floor(sec % 60);
	return `${m}:${s.toString().padStart(2, '0')}`;
}
