export interface TempoEstimate {
	bpm: number;
	/** Seconds to the first beat. */
	offset: number;
}

/** Results land in [90, 180), where essentia's RhythmExtractor2013 puts most songs. */
const OCTAVE_LOW = 90;
export const FRAMES_PER_SECOND = 100;

/** In-place iterative radix-2 complex FFT; `inverse` skips the 1/n scale. */
function fft(re: Float64Array, im: Float64Array, inverse = false): void {
	const n = re.length;
	for (let i = 1, j = 0; i < n; i++) {
		let bit = n >> 1;
		for (; j & bit; bit >>= 1) j ^= bit;
		j ^= bit;
		if (i < j) {
			[re[i], re[j]] = [re[j], re[i]];
			[im[i], im[j]] = [im[j], im[i]];
		}
	}
	const sign = inverse ? 1 : -1;
	for (let len = 2; len <= n; len <<= 1) {
		const angle = (sign * 2 * Math.PI) / len;
		const wr = Math.cos(angle);
		const wi = Math.sin(angle);
		const half = len >> 1;
		for (let i = 0; i < n; i += len) {
			let cr = 1;
			let ci = 0;
			for (let j = 0; j < half; j++) {
				const a = i + j;
				const b = a + half;
				const vr = re[b] * cr - im[b] * ci;
				const vi = re[b] * ci + im[b] * cr;
				re[b] = re[a] - vr;
				im[b] = im[a] - vi;
				re[a] += vr;
				im[a] += vi;
				const t = cr * wr - ci * wi;
				ci = cr * wi + ci * wr;
				cr = t;
			}
		}
	}
}

/** About 46 ms, a power of two: 2048 samples at 44.1 or 48 kHz. */
function frameSize(sampleRate: number): number {
	return 2 ** Math.round(Math.log2(sampleRate * 0.046));
}

/** Log-compressed spectral flux at FRAMES_PER_SECOND, over the whole spectrum and
 * below 150 Hz (the kick). Frame f is centred half a frame after f hops. */
function onsetEnvelopes(
	samples: Float32Array,
	sampleRate: number,
): { full: Float64Array; low: Float64Array } {
	const hop = sampleRate / FRAMES_PER_SECOND;
	const frame = frameSize(sampleRate);
	const count = Math.max(0, Math.floor((samples.length - frame) / hop) + 1);
	const bins = Math.min(frame / 2, Math.round((11000 * frame) / sampleRate));
	const lowBins = Math.max(2, Math.round((150 * frame) / sampleRate));
	const window = new Float64Array(frame);
	for (let i = 0; i < frame; i++)
		window[i] = 0.5 - 0.5 * Math.cos((2 * Math.PI * i) / frame);

	const re = new Float64Array(frame);
	const im = new Float64Array(frame);
	let prev = new Float64Array(bins);
	let cur = new Float64Array(bins);
	const full = new Float64Array(count);
	const low = new Float64Array(count);
	for (let f = 0; f < count; f++) {
		const start = Math.round(f * hop);
		for (let i = 0; i < frame; i++) {
			re[i] = samples[start + i] * window[i];
			im[i] = 0;
		}
		fft(re, im);
		let sum = 0;
		let lowSum = 0;
		for (let k = 1; k < bins; k++) {
			cur[k] = Math.log1p(100 * Math.hypot(re[k], im[k]));
			const rise = f > 0 ? Math.max(0, cur[k] - prev[k]) : 0;
			sum += rise;
			if (k <= lowBins) lowSum += rise;
		}
		full[f] = sum;
		low[f] = lowSum;
		[prev, cur] = [cur, prev];
	}
	return { full: detrend(full), low: detrend(low) };
}

/** Subtracts a moving average so sustained loudness doesn't read as onsets. */
function detrend(flux: Float64Array): Float64Array {
	const count = flux.length;
	const half = Math.round(FRAMES_PER_SECOND * 0.25);
	const out = new Float64Array(count);
	let acc = 0;
	for (let i = 0; i < Math.min(count, half); i++) acc += flux[i];
	for (let i = 0; i < count; i++) {
		if (i + half < count) acc += flux[i + half];
		if (i - half - 1 >= 0) acc -= flux[i - half - 1];
		const n = Math.min(count - 1, i + half) - Math.max(0, i - half) + 1;
		out[i] = Math.max(0, flux[i] - acc / n);
	}
	return out;
}

export function onsetEnvelope(
	samples: Float32Array,
	sampleRate: number,
): Float64Array {
	return onsetEnvelopes(samples, sampleRate).full;
}

/** Unbiased autocorrelation via FFT, normalised so lag 0 is 1. */
function autocorrelate(x: Float64Array, maxLag: number): Float64Array {
	let n = 1;
	while (n < x.length * 2) n <<= 1;
	const re = new Float64Array(n);
	const im = new Float64Array(n);
	re.set(x);
	fft(re, im);
	for (let i = 0; i < n; i++) {
		re[i] = re[i] * re[i] + im[i] * im[i];
		im[i] = 0;
	}
	fft(re, im, true);
	const out = new Float64Array(maxLag + 1);
	const zero = re[0] / x.length || 1;
	for (let lag = 0; lag <= maxLag && lag < x.length; lag++)
		out[lag] = re[lag] / (x.length - lag) / zero;
	return out;
}

function sampleAt(a: Float64Array, pos: number): number {
	const i = Math.floor(pos);
	if (i + 1 >= a.length) return 0;
	const t = pos - i;
	return a[i] * (1 - t) + a[i + 1] * t;
}

export function estimateTempo(
	samples: Float32Array,
	sampleRate: number,
): TempoEstimate {
	const { full: env, low } = onsetEnvelopes(samples, sampleRate);
	const fps = FRAMES_PER_SECOND;
	const maxLag = Math.min(
		env.length - 1,
		Math.ceil((fps * 60 * 4) / OCTAVE_LOW),
	);
	const acf = autocorrelate(env, maxLag);

	// One octave of candidates, each scored on its beat, half bar, bar and half beat.
	const score = (bpm: number) => {
		const p = (fps * 60) / bpm;
		return (
			sampleAt(acf, p) +
			0.5 * sampleAt(acf, 2 * p) +
			0.25 * sampleAt(acf, 4 * p) +
			0.5 * sampleAt(acf, p / 2)
		);
	};
	let best = OCTAVE_LOW;
	let bestScore = -Infinity;
	for (let bpm = OCTAVE_LOW; bpm < OCTAVE_LOW * 2; bpm += 0.1) {
		const s = score(bpm);
		if (s > bestScore) {
			bestScore = s;
			best = bpm;
		}
	}

	// Refine on the whole song: a tempo even 1% off drifts out of phase with the beats.
	let fit = gridFit(env, (fps * 60) / best);
	let refined = best;
	for (let bpm = best * 0.98; bpm <= best * 1.02; bpm += 0.01) {
		const f = gridFit(env, (fps * 60) / bpm);
		if (f.score > fit.score) {
			fit = f;
			refined = bpm;
		}
	}

	// Hats and snares can out-flux the kick; the beat is whichever half the kick favours.
	const period = (fps * 60) / refined;
	let phase = fit.phase;
	const offbeat = (phase + period / 2) % period;
	if (gridSum(low, period, offbeat) > gridSum(low, period, phase))
		phase = offbeat;

	const beat = 60 / refined;
	const offset = (phase / fps + frameSize(sampleRate) / 2 / sampleRate) % beat;
	return { bpm: refined, offset };
}

function gridSum(env: Float64Array, period: number, phase: number): number {
	let sum = 0;
	for (let t = phase; t < env.length - 1; t += period) sum += sampleAt(env, t);
	return sum;
}

/** How strongly the onsets land on a beat grid of this period, at its best phase. */
export function gridFit(
	env: Float64Array,
	period: number,
): { score: number; phase: number } {
	let mean = 0;
	for (let i = 0; i < env.length; i++) mean += env[i];
	mean /= env.length || 1;
	let score = 0;
	let phase = 0;
	for (let p = 0; p < period; p += 0.5) {
		let sum = 0;
		let n = 0;
		for (let t = p; t < env.length - 1; t += period, n++)
			sum += sampleAt(env, t);
		const s = sum / (n || 1) / (mean || 1);
		if (s > score) {
			score = s;
			phase = p;
		}
	}
	return { score, phase };
}
