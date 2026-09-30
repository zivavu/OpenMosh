import { describe, expect, test } from "bun:test";
import { estimateTempo } from "./tempo";

/** Kicks on the beat, quieter hats on the off-beat, a decaying 60 Hz / 8 kHz burst each. */
function beatTrack(
	bpm: number,
	sampleRate: number,
	seconds: number,
	offset: number,
): Float32Array {
	const out = new Float32Array(Math.round(seconds * sampleRate));
	const beat = 60 / bpm;
	const hit = (at: number, freq: number, gain: number) => {
		const start = Math.round(at * sampleRate);
		const length = Math.round(0.08 * sampleRate);
		for (let i = 0; i < length && start + i < out.length; i++) {
			const t = i / sampleRate;
			out[start + i] +=
				gain * Math.exp(-t * 40) * Math.sin(2 * Math.PI * freq * t);
		}
	};
	for (let t = offset; t < seconds; t += beat) {
		hit(t, 60, 0.8);
		hit(t + beat / 2, 8000, 0.3);
	}
	return out;
}

describe("estimateTempo", () => {
	for (const [bpm, rate] of [
		[128, 44100],
		[174, 48000],
		[95, 44100],
		[140.5, 22050],
	]) {
		test(`finds ${bpm} BPM at ${rate} Hz`, () => {
			const offset = 0.23;
			const result = estimateTempo(beatTrack(bpm, rate, 40, offset), rate);
			expect(Math.abs(result.bpm - bpm)).toBeLessThan(0.1);
			const beat = 60 / bpm;
			const gap = Math.abs(result.offset - (offset % beat));
			expect(Math.min(gap, beat - gap)).toBeLessThan(0.03);
		});
	}

	test("folds tempos outside 90-180 into that octave", () => {
		expect(
			Math.round(estimateTempo(beatTrack(200, 44100, 30, 0), 44100).bpm),
		).toBe(100);
		expect(
			Math.round(estimateTempo(beatTrack(70, 44100, 30, 0), 44100).bpm),
		).toBe(140);
	});

	test("survives silence and very short input", () => {
		expect(
			estimateTempo(new Float32Array(44100 * 5), 44100).bpm,
		).toBeGreaterThan(0);
		expect(estimateTempo(new Float32Array(1000), 44100).bpm).toBeGreaterThan(0);
	});
});
