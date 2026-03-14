/**
 * Measure the approximate loudness of an AudioBuffer in dBFS using RMS
 * with a one-pole high-pass filter at ~80 Hz (approximates K-weighting low-end rolloff).
 *
 * Returns dBFS value (negative number for normal audio, -Infinity for silence).
 */
export function measureLoudness(buffer: AudioBuffer): number {
	const sampleRate = buffer.sampleRate;
	const numChannels = buffer.numberOfChannels;
	const length = buffer.length;

	// One-pole HPF coefficient: a ≈ 0.988–0.989 at 44100–48000 Hz
	// Recurrence: y[n] = a * (y[n-1] + x[n] - x[n-1])
	// -3 dB point is at ~80 Hz; attenuates sub-bass and DC
	const a = Math.exp(-2 * Math.PI * 80 / sampleRate);

	// Hoist channel arrays outside the hot loop
	const channels: Float32Array[] = [];
	for (let ch = 0; ch < numChannels; ch++) {
		channels.push(buffer.getChannelData(ch));
	}

	let sumSq = 0;
	let prevX = 0;
	let prevY = 0;

	for (let i = 0; i < length; i++) {
		// Mix down to mono
		let sample = 0;
		for (let ch = 0; ch < numChannels; ch++) {
			sample += channels[ch]![i];
		}
		sample /= numChannels;

		// Apply one-pole high-pass filter
		const y = a * (prevY + sample - prevX);
		prevX = sample;
		prevY = y;

		sumSq += y * y;
	}

	const rms = length > 0 ? Math.sqrt(sumSq / length) : 0;
	return rms > 0 ? 20 * Math.log10(rms) : -Infinity;
}

/**
 * Compute a linear gain factor to bring audio from measuredDb to targetDb.
 * Uses RMS dBFS approximation, not true BS.1770 LUFS measurement.
 * Clamped to [0.1, 10] to avoid extreme amplification of near-silent files.
 */
export function computeNormalizeGain(measuredDb: number, targetDb: number = -14): number {
	if (!isFinite(measuredDb)) return 1.0; // silent file: leave as-is
	const gain = Math.pow(10, (targetDb - measuredDb) / 20);
	return Math.max(0.1, Math.min(10, gain));
}
