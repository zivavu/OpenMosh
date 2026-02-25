import { getDefinition, type EffectInstance } from './effects';

const FFT_SIZE = 2048;

/**
 * Decode an audio file to an AudioBuffer using the Web Audio API.
 */
export async function decodeAudioFile(file: File): Promise<AudioBuffer> {
	const arrayBuffer = await file.arrayBuffer();
	const ctx = new AudioContext();
	const buffer = await ctx.decodeAudioData(arrayBuffer);
	await ctx.close();
	return buffer;
}

/**
 * Create a new AudioBuffer containing only the samples in [start, end] (seconds).
 */
export async function trimAudioBuffer(
	buffer: AudioBuffer,
	start: number,
	end: number,
): Promise<AudioBuffer> {
	const sampleRate = buffer.sampleRate;
	const startSample = Math.max(0, Math.floor(start * sampleRate));
	const endSample = Math.min(buffer.length, Math.ceil(end * sampleRate));
	const length = Math.max(0, endSample - startSample);

	const ctx = new AudioContext();
	const trimmed = ctx.createBuffer(
		buffer.numberOfChannels,
		length,
		sampleRate,
	);

	for (let ch = 0; ch < buffer.numberOfChannels; ch++) {
		const src = buffer.getChannelData(ch);
		const dst = trimmed.getChannelData(ch);
		for (let i = 0; i < length; i++) {
			dst[i] = src[startSample + i];
		}
	}
	await ctx.close();
	return trimmed;
}

export interface FrameAudioData {
	volumeLevel: number;
	frequencyData: Uint8Array;
}

/**
 * In-place radix-2 FFT. Input and output in real/imag arrays; output is magnitude in freqData[0..fftSize/2].
 */
function fftMagnitude(
	real: Float32Array,
	imag: Float32Array,
	magnitude: Float32Array,
	fftSize: number,
): void {
	const n = fftSize;
	// Bit-reversal permutation
	const log2n = Math.round(Math.log2(n));
	for (let i = 0; i < n; i++) {
		let j = 0;
		let x = i;
		for (let b = 0; b < log2n; b++) {
			j = (j << 1) | (x & 1);
			x >>= 1;
		}
		if (i < j) {
			[real[i], real[j]] = [real[j], real[i]];
			[imag[i], imag[j]] = [imag[j], imag[i]];
		}
	}

	// Cooley-Tukey
	for (let len = 2; len <= n; len *= 2) {
		const angle = (-2 * Math.PI) / len;
		for (let i = 0; i < n; i += len) {
			for (let j = 0; j < len / 2; j++) {
				const idx1 = i + j;
				const idx2 = i + j + len / 2;
				const t = angle * j;
				const wReal = Math.cos(t);
				const wImag = Math.sin(t);
				const uReal = real[idx1];
				const uImag = imag[idx1];
				const vReal = real[idx2] * wReal - imag[idx2] * wImag;
				const vImag = real[idx2] * wImag + imag[idx2] * wReal;
				real[idx1] = uReal + vReal;
				imag[idx1] = uImag + vImag;
				real[idx2] = uReal - vReal;
				imag[idx2] = uImag - vImag;
			}
		}
	}

	// Magnitude for first half (positive frequencies)
	const half = n / 2;
	let maxMag = 0;
	for (let i = 0; i < half; i++) {
		const mag = Math.sqrt(real[i] * real[i] + imag[i] * imag[i]);
		magnitude[i] = mag;
		if (mag > maxMag) maxMag = mag;
	}
	// Normalize to 0-1 for later byte conversion
	if (maxMag > 0) {
		for (let i = 0; i < half; i++) {
			magnitude[i] /= maxMag;
		}
	}
}

function getLevelFromFrequencyRange(
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

/**
 * Extract a single frame's audio analysis at time t (seconds): RMS volume and frequency bins (0-255).
 */
function computeFrameAnalysis(
	buffer: AudioBuffer,
	timeSeconds: number,
	fftSize: number,
): FrameAudioData {
	const sampleRate = buffer.sampleRate;
	const numChannels = buffer.numberOfChannels;
	const length = buffer.length;
	const frameStartSample = Math.max(
		0,
		Math.floor(timeSeconds * sampleRate) - Math.floor(fftSize / 2),
	);
	const frameEndSample = Math.min(length, frameStartSample + fftSize);
	const actualLength = frameEndSample - frameStartSample;

	// Time-domain: mix down to mono and compute RMS
	let sumSq = 0;
	const timeSamples: number[] = [];
	for (let i = 0; i < actualLength; i++) {
		let s = 0;
		for (let ch = 0; ch < numChannels; ch++) {
			s += buffer.getChannelData(ch)[frameStartSample + i];
		}
		s /= numChannels;
		timeSamples.push(s);
		sumSq += s * s;
	}
	const volumeLevel =
		actualLength > 0 ? Math.min(1, Math.sqrt(sumSq / actualLength)) : 0;

	// Pad to fftSize for FFT
	const real = new Float32Array(fftSize);
	const imag = new Float32Array(fftSize);
	for (let i = 0; i < actualLength; i++) {
		real[i] = timeSamples[i];
	}
	// Apply Hann window
	for (let i = 0; i < actualLength; i++) {
		const w = 0.5 * (1 - Math.cos((2 * Math.PI * i) / (actualLength - 1 || 1)));
		real[i] *= w;
	}

	const magnitude = new Float32Array(fftSize / 2);
	fftMagnitude(real, imag, magnitude, fftSize);

	// Convert magnitude to byte frequency data (0-255), similar to AnalyserNode.getByteFrequencyData
	const frequencyData = new Uint8Array(fftSize / 2);
	for (let i = 0; i < frequencyData.length; i++) {
		// AnalyserNode uses dB scale; we use linear normalized, scaled to 0-255
		const v = Math.min(255, Math.floor(magnitude[i] * 255));
		frequencyData[i] = v;
	}

	return { volumeLevel, frequencyData };
}

/**
 * Pre-compute audio analysis for each frame timestamp.
 */
export function analyzeFrames(
	buffer: AudioBuffer,
	frameTimes: number[],
	fftSize: number = FFT_SIZE,
): FrameAudioData[] {
	return frameTimes.map((t) => computeFrameAnalysis(buffer, t, fftSize));
}

/**
 * Apply pre-computed frame audio data to effects' values (volume-linked params).
 * Modifies effect.values in place.
 */
export function applyFrameAudioToEffects(
	effects: EffectInstance[],
	frameData: FrameAudioData,
	sampleRate: number,
	fftSize: number,
): void {
	const { volumeLevel, frequencyData } = frameData;

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
