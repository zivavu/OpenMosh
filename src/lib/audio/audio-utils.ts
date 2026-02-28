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
