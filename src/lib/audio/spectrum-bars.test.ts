import { beforeEach, describe, expect, it } from "bun:test";
import { SPECTRUM_MAX_DB, SPECTRUM_MIN_DB } from "./offline-audio";
import {
	barEdges,
	dropSpectrumBars,
	resetSpectrumBars,
	stepSpectrumBars,
} from "./spectrum-bars";

const RATE = 48000;
const BINS = 1024;
const BARS = 48;
const binHz = RATE / 2 / BINS;

/** Bins shaped by `db(hz)`, quantized the way an AnalyserNode would. */
function bins(db: (hz: number) => number): Uint8Array {
	const a = new Uint8Array(BINS);
	for (let i = 0; i < BINS; i++) {
		const v =
			(db(i * binHz) - SPECTRUM_MIN_DB) / (SPECTRUM_MAX_DB - SPECTRUM_MIN_DB);
		a[i] = Math.round(255 * Math.max(0, Math.min(1, v)));
	}
	return a;
}

/** Music-like: loses 3 dB an octave above 100 Hz. */
const pink = (top: number) => (hz: number) =>
	top - 3 * Math.log2(Math.max(hz, 100) / 100);

function play(
	key: string,
	frame: (t: number) => Uint8Array | null,
	seconds: number,
	{ fps = 60, smoothing = 0.45, startT = 0 } = {},
) {
	const dt = 1 / fps;
	const frames: { level: number[]; peak: number[] }[] = [];
	let t = startT;
	for (let f = 0; f < Math.round(seconds * fps); f++, t += dt) {
		const out = stepSpectrumBars(key, frame(t), RATE, dt, BARS, smoothing);
		const level: number[] = [];
		const peak: number[] = [];
		for (let b = 0; b < BARS; b++) {
			level.push(out[b * 2] / 255);
			peak.push(out[b * 2 + 1] / 255);
		}
		frames.push({ level, peak });
	}
	return { frames, t, last: frames[frames.length - 1] };
}

function barOf(hz: number): number {
	const edges = barEdges(BARS);
	for (let b = 0; b < BARS; b++) if (hz < edges[b + 1]) return b;
	return BARS - 1;
}

describe("barEdges", () => {
	it("spans 30 Hz to 16 kHz in rising order", () => {
		const edges = barEdges(BARS);
		expect(edges[0]).toBeCloseTo(30, 3);
		expect(edges[BARS]).toBeCloseTo(16000, 0);
		for (let b = 0; b < BARS; b++)
			expect(edges[b + 1]).toBeGreaterThan(edges[b]);
	});

	it("keeps the sub-bass, which few bins resolve, to a handful of bars", () => {
		// A pure log scale gave a fifth of the bars to 30-100 Hz, about four bins.
		expect(barOf(100)).toBeLessThan(BARS * 0.15);
	});
});

describe("stepSpectrumBars", () => {
	beforeEach(resetSpectrumBars);

	it("lights the bar a tone sits in", () => {
		const tone = bins((hz) => (Math.abs(hz - 1000) < 30 ? -25 : -95));
		const { last } = play("tone", () => tone, 1);
		const tallest = last.level.indexOf(Math.max(...last.level));
		expect(tallest).toBe(barOf(1000));
	});

	it("keeps a loud kick moving instead of pinning the low end", () => {
		// A mastered kick reaches past -30 dB, where the old window clipped it flat.
		const kick = (t: number) => {
			const hit = Math.exp(-((t % 0.5) / 0.08));
			return bins((hz) => (hz < 150 ? -36 + 22 * hit : pink(-40)(hz)));
		};
		const { frames } = play("kick", kick, 4);
		const bass = barOf(60);
		const levels = frames.slice(60).map((f) => f.level[bass]);
		expect(Math.max(...levels)).toBeGreaterThan(0.7);
		expect(Math.max(...levels) - Math.min(...levels)).toBeGreaterThan(0.3);
	});

	it("evens out the music's tilt so the highs reach as high as the mids", () => {
		const { last } = play("pink", () => bins(pink(-25)), 2);
		expect(last.level[barOf(10000)]).toBeGreaterThan(
			last.level[barOf(1000)] * 0.8,
		);
	});

	it("keeps an intro well below the drop that follows it", () => {
		const tallest = (r: ReturnType<typeof play>) =>
			Math.max(...r.frames.slice(-60).flatMap((f) => f.level));
		const intro = play("song", () => bins(pink(-38)), 20);
		const drop = play("song", () => bins(pink(-20)), 10, { startT: intro.t });
		expect(tallest(intro)).toBeLessThan(0.6);
		expect(tallest(drop)).toBeGreaterThan(0.85);
	});

	it("doesn't stretch a breakdown back up to the drop's height", () => {
		const tallest = (r: ReturnType<typeof play>) =>
			Math.max(...r.frames.slice(-60).flatMap((f) => f.level));
		const drop = play("break", () => bins(pink(-20)), 20);
		const breakdown = play("break", () => bins(pink(-32)), 20, {
			startT: drop.t,
		});
		expect(tallest(breakdown)).toBeLessThan(tallest(drop) - 0.2);
	});

	it("keeps silence silent and doesn't stretch room tone to full height", () => {
		expect(
			Math.max(...play("silence", () => new Uint8Array(BINS), 3).last.level),
		).toBe(0);
		const hiss = play("hiss", () => bins(() => -78), 5).last;
		expect(Math.max(...hiss.level)).toBeLessThan(0.35);
	});

	it("falls under gravity: slowly at first, then faster", () => {
		const loud = bins(pink(-20));
		const quiet = bins(() => -100);
		const settled = play("fall", () => loud, 2);
		const { frames } = play("fall", () => quiet, 0.3, { startT: settled.t });
		const bar = barOf(1000);
		const start = settled.last.level[bar];
		const first = start - frames[2].level[bar];
		const second = frames[2].level[bar] - frames[5].level[bar];
		expect(second).toBeGreaterThan(first);
	});

	it("falls slower as smoothing rises", () => {
		const fallAfter = (smoothing: number) => {
			const key = `s${smoothing}`;
			const loud = play(key, () => bins(pink(-20)), 2, { smoothing });
			return play(key, () => null, 0.2, { smoothing, startT: loud.t }).last
				.level[barOf(1000)];
		};
		expect(fallAfter(0.9)).toBeGreaterThan(fallAfter(0.45));
		expect(fallAfter(0.45)).toBeGreaterThanOrEqual(fallAfter(0));
	});

	it("drops every bar to zero when the music stops", () => {
		const settled = play("stop", () => bins(pink(-20)), 2);
		const { last } = play("stop", () => null, 3, { startT: settled.t });
		expect(Math.max(...last.level)).toBe(0);
	});

	it("holds a cap at the high point, then lets it fall without passing the bar", () => {
		const settled = play("cap", () => bins(pink(-20)), 2);
		const bar = barOf(1000);
		const top = settled.last.peak[bar];
		const { frames } = play("cap", () => bins(() => -100), 2, {
			startT: settled.t,
		});
		expect(frames[10].peak[bar]).toBe(top);
		expect(frames[10].level[bar]).toBeLessThan(top);
		for (const f of frames)
			expect(f.peak[bar]).toBeGreaterThanOrEqual(f.level[bar]);
		expect(frames[frames.length - 1].peak[bar]).toBe(0);
	});

	it("agrees at 30fps and 60fps", () => {
		// A 30fps export has to match the 60fps preview it was set up against.
		const beat = (t: number) =>
			bins(pink(-30 + 12 * Math.exp(-((t % 0.5) / 0.1))));
		const mean = (r: ReturnType<typeof play>) =>
			r.frames.reduce((s, f) => s + f.level.reduce((a, v) => a + v, 0), 0) /
			(r.frames.length * BARS);
		const at60 = mean(play("60", beat, 4, { fps: 60 }));
		const at30 = mean(play("30", beat, 4, { fps: 30 }));
		expect(Math.abs(at60 - at30)).toBeLessThan(0.05);
	});

	it("keeps each instance's bars apart, and forgets a dropped one", () => {
		play("a", () => bins(pink(-20)), 1);
		const fresh = stepSpectrumBars("b", null, RATE, 1 / 60, BARS, 0.45);
		expect(fresh[barOf(1000) * 2]).toBe(0);
		dropSpectrumBars("a");
		const dropped = stepSpectrumBars("a", null, RATE, 1 / 60, BARS, 0.45);
		expect(dropped[barOf(1000) * 2]).toBe(0);
	});

	it("starts over when the bar count changes", () => {
		play("count", () => bins(pink(-20)), 1);
		const out = stepSpectrumBars("count", null, RATE, 1 / 60, 16, 0.45);
		expect(out.length).toBe(32);
		expect(Math.max(...out)).toBe(0);
	});
});
