/** Approximate loudness in dBFS: RMS through a one-pole high-pass at ~80 Hz (approximates
 * K-weighting low-end rolloff). Negative for normal audio, -Infinity for silence. */
export function measureLoudness(buffer: AudioBuffer): number {
	const sampleRate = buffer.sampleRate;
	const numChannels = buffer.numberOfChannels;
	const length = buffer.length;

	// One-pole HPF at ~80 Hz: y[n] = a*(y[n-1] + x[n] - x[n-1]); attenuates sub-bass/DC.
	const a = Math.exp((-2 * Math.PI * 80) / sampleRate);

	const channels: Float32Array[] = [];
	for (let ch = 0; ch < numChannels; ch++) {
		channels.push(buffer.getChannelData(ch));
	}

	let sumSq = 0;
	let prevX = 0;
	let prevY = 0;

	for (let i = 0; i < length; i++) {
		let sample = 0;
		for (let ch = 0; ch < numChannels; ch++) {
			sample += channels[ch]![i];
		}
		sample /= numChannels;

		const y = a * (prevY + sample - prevX);
		prevX = sample;
		prevY = y;

		sumSq += y * y;
	}

	const rms = length > 0 ? Math.sqrt(sumSq / length) : 0;
	return rms > 0 ? 20 * Math.log10(rms) : -Infinity;
}

/** Linear gain from measuredDb to targetDb. RMS dBFS approximation, not true BS.1770
 * LUFS. Clamped to [0.1, 10] to avoid amplifying near-silent files. */
export function computeNormalizeGain(
	measuredDb: number,
	targetDb: number = -14,
): number {
	if (!isFinite(measuredDb)) return 1.0; // silent file: leave as-is
	const gain = Math.pow(10, (targetDb - measuredDb) / 20);
	return Math.max(0.1, Math.min(10, gain));
}
