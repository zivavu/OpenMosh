import { describe, expect, test } from "bun:test";
import { analyzeDrive } from "../analyze";
import { findCuts, type SongAudio } from "../listen";
import { buildControls, sampleControls, type Controls } from "./controls";
import {
	ARCS_CONTROLS,
	ARCS_KNOBS,
	arcsLook,
	normalizeArcsSpec,
	type ArcsSpec,
	type Look,
} from "./look";
import { familyOf, figureOf, FIGURE_NAMES } from "./figures";
import {
	ARC_FLOATS,
	buildArcs,
	MAX_ARC_VERTICES,
	MAX_STROKES,
	STROKE_FLOATS,
} from "./strokes";

const RATE = 48000;

/** A fake with only what the analyser reads. */
function buffer(seconds: number, sample: (t: number, i: number) => number) {
	const data = new Float32Array(RATE * seconds);
	for (let i = 0; i < data.length; i++) data[i] = sample(i / RATE, i);
	return {
		duration: seconds,
		length: data.length,
		sampleRate: RATE,
		numberOfChannels: 1,
		getChannelData: () => data,
	} as unknown as AudioBuffer;
}

const kickAt = (x: number) =>
	0.8 * Math.exp(-x * 25) * Math.sin(2 * Math.PI * 60 * x);

/** Quiet for 8 s, then a 120 BPM kick with hats and a held note. */
const dropSong = () =>
	buffer(40, (t, i) => {
		if (t < 8) return 0;
		const hat = 0.2 * Math.exp(-((t + 0.25) % 0.5) * 60);
		return (
			kickAt((t - 8) % 0.5) +
			hat * Math.sin(i * 1.7) +
			0.05 * Math.sin(2 * Math.PI * 800 * t)
		);
	});

const songs = new Map<string, Promise<SongAudio>>();
function analysed(name: string, make: () => AudioBuffer) {
	if (!songs.has(name)) songs.set(name, analyzeDrive(make()));
	return songs.get(name)!;
}
const drop = () => analysed("drop", dropSong);

const sum = (a: Float32Array) => a.reduce((x, y) => x + y, 0);

function controlsOf(song: SongAudio, seed = 1): Controls {
	return buildControls(song, arcsLook({ seed, palette: "Ice" }));
}

const LOOK = arcsLook({ seed: 1, palette: "Ice" });
const out = new Float32Array(MAX_ARC_VERTICES * ARC_FLOATS);
const table = new Float32Array(MAX_STROKES * STROKE_FLOATS);

function arcsAt(c: Controls, t: number, look = LOOK) {
	const { vertices } = buildArcs(
		out,
		table,
		sampleControls(c, t),
		c,
		look,
		576,
		720,
	);
	return out.slice(0, vertices * ARC_FLOATS);
}

function strokesAt(c: Controls, t: number, look = LOOK) {
	return buildArcs(out, table, sampleControls(c, t), c, look, 576, 720).strokes;
}

describe("the song table", () => {
	test("hits land on the beat and silence stays at nothing", async () => {
		const c = controlsOf(await drop());
		expect(c.onsets[0] / 60).toBeCloseTo(8, 0);
		for (const f of c.onsets) {
			const offBeat = ((f / 60 - 8) % 0.5) * 60;
			expect(Math.min(offBeat, 30 - offBeat)).toBeLessThanOrEqual(3);
		}
		const quiet = sampleControls(c, 4);
		expect(quiet.kick).toBe(0);
		expect(quiet.energy).toBe(0);
		expect(sampleControls(c, 12.02).kick).toBeGreaterThan(0.3);
	});

	test("a band with nothing in it reads silent, not full", async () => {
		const pad = await analysed("pad", () =>
			buffer(20, (t) => 0.03 * Math.sin(2 * Math.PI * 440 * t)),
		);
		const c = controlsOf(pad);
		// A band read as full would sum to about 1200, one per frame.
		expect(sum(c.kick)).toBeLessThan(1);
		expect(sum(c.bass)).toBeLessThan(1);
		expect(sum(c.mid)).toBeGreaterThan(100);
	});

	test("is indexed by time, however much of the song is silent", async () => {
		const c = controlsOf(await drop());
		expect(c.frames).toBe(40 * 60);
		expect(sampleControls(c, 7.9).presence).toBe(0);
		expect(sampleControls(c, 9).presence).toBeGreaterThan(0);
	});

	test("figures change on a hit and sections count up", async () => {
		const c = controlsOf(await drop());
		expect(c.cuts.length).toBeGreaterThan(1);
		for (const cut of c.cuts) expect(c.onsets).toContain(cut);
		const last = sampleControls(c, 39.9);
		expect(last.sectionB).toBe(c.cuts.length);
	});

	test("cuts keep their distance even when the song jumps constantly", () => {
		const energy = Float32Array.from({ length: 3600 }, (_, i) =>
			Math.floor(i / 120) % 2 ? 1 : 0,
		);
		const cuts = findCuts(energy, [], 8);
		for (let i = 1; i < cuts.length; i++) {
			expect(cuts[i] - cuts[i - 1]).toBeGreaterThanOrEqual(4 * 60);
		}
	});
});

describe("listening", () => {
	const listening = (tuning: NonNullable<ArcsSpec["tuning"]>) =>
		arcsLook({ seed: 1, palette: "Ice", tuning });
	const onsetsWith = async (tuning: NonNullable<ArcsSpec["tuning"]>) =>
		buildControls(await drop(), listening(tuning)).onsets;

	test("hits only come from the band it's told to hear", async () => {
		// Smooth-edged bursts, so neither leaks a click into the other's band.
		const burst = (x: number, hz: number) =>
			x < 0.2
				? Math.sin((Math.PI * x) / 0.2) ** 2 * Math.sin(2 * Math.PI * hz * x)
				: 0;
		const song = await analysed("alternating", () =>
			buffer(
				20,
				(t) => 0.7 * burst(t % 1, 60) + 0.7 * burst((t + 0.5) % 1, 3000),
			),
		);
		const phases = (hitFreqLow: number, hitFreqHigh: number) =>
			buildControls(song, listening({ hitFreqLow, hitFreqHigh })).onsets.map(
				(f) => (f / 60) % 1,
			);
		const lows = phases(30, 140);
		const highs = phases(2000, 4000);
		expect(lows.length).toBeGreaterThan(5);
		expect(highs.length).toBeGreaterThan(5);
		for (const p of lows) expect(p).toBeLessThan(0.3);
		for (const p of highs) expect(p).toBeGreaterThan(0.4);
	});

	test("swapped band edges read the same band", async () => {
		expect(await onsetsWith({ hitFreqLow: 140, hitFreqHigh: 30 })).toEqual(
			await onsetsWith({ hitFreqLow: 30, hitFreqHigh: 140 }),
		);
	});

	test("more sensitivity never hears fewer hits", async () => {
		const deaf = await onsetsWith({ hitSense: 0 });
		const keen = await onsetsWith({ hitSense: 1 });
		expect(keen.length).toBeGreaterThanOrEqual(deaf.length);
		expect(keen.length).toBeGreaterThan(0);
	});

	test("hits keep the distance they're given", async () => {
		const onsets = await onsetsWith({ hitSense: 1, hitSpacing: 1 });
		for (let i = 1; i < onsets.length; i++) {
			expect(onsets[i] - onsets[i - 1]).toBeGreaterThanOrEqual(60);
		}
	});

	test("smoothing slows how a band falls", async () => {
		const song = await drop();
		const fall = (hitSmooth: number) => {
			const c = buildControls(song, listening({ hitSmooth }));
			return sampleControls(c, 12.3).kick;
		};
		expect(fall(1)).toBeGreaterThan(fall(0));
	});

	test("section sensitivity at 0 leaves only the timer", () => {
		const energy = Float32Array.from({ length: 3600 }, (_, i) =>
			i > 1800 ? 1 : 0,
		);
		expect(findCuts(energy, [], 60, 1).length).toBeGreaterThan(0);
		expect(findCuts(energy, [], 60, 0)).toEqual([]);
	});
});

describe("the pen", () => {
	test("none in silence, and a figure that builds with the music", async () => {
		const c = controlsOf(await drop());
		expect(arcsAt(c, 4).length).toBe(0);
		const start = c.cuts[1] / 60;
		const early = strokesAt(c, start + 1.3);
		expect(early).toBeGreaterThan(0);
		expect(strokesAt(c, start + 4)).toBeGreaterThan(early);
	});

	test("only runs forward in a section, and finishes before the end of one with music", async () => {
		const c = controlsOf(await drop());
		const ends = [...c.cuts, c.frames];
		ends.forEach((end, section) => {
			const from = section > 0 ? ends[section - 1] : 0;
			for (let i = from + 1; i < end; i++) {
				expect(c.pen[i]).toBeGreaterThanOrEqual(c.pen[i - 1]);
			}
			// The first section is the song's silence, with the drop only in its last moments.
			if (section === 0) return;
			const finished = c.pen.subarray(from, end).findIndex((p) => p >= 1);
			expect(finished).toBeGreaterThan(-1);
			expect(finished).toBeLessThan(end - from - 1);
		});
	});

	test("takes its time even when the music arrives at the end of a section", async () => {
		const c = controlsOf(await drop());
		for (let i = 1; i < c.frames; i++) {
			const step = c.pen[i] - c.pen[i - 1];
			if (step > 0) expect(step).toBeLessThanOrEqual(1 / 90 + 1e-5);
		}
	});

	test("a hit moves it further than the same time between hits", async () => {
		const c = controlsOf(await drop());
		const onset = c.onsets.find((f) => f > c.cuts[0] + 60)!;
		const across = c.pen[onset] - c.pen[onset - 1];
		const between = c.pen[onset - 1] - c.pen[onset - 2];
		expect(across).toBeGreaterThan(between * 3);
	});

	test("the leaving figure is erased as the next one starts, then gone", async () => {
		const c = controlsOf(await drop());
		const cut = c.cuts[1] / 60;
		const during = sampleControls(c, cut + 0.3);
		expect(during.sectionA).toBe(during.sectionB - 1);
		expect(during.morph).toBeGreaterThan(0);
		const after = sampleControls(c, cut + 2);
		expect(after.sectionA).toBe(after.sectionB);
		expect(strokesAt(c, cut + 0.3)).toBeGreaterThan(
			strokesAt(c, cut + 0.05 + 1.25),
		);
	});
});

describe("strokes", () => {
	test("a moment draws the same however the playhead got there", async () => {
		const c = controlsOf(await drop());
		const first = arcsAt(c, 12.1);
		arcsAt(c, 3);
		arcsAt(c, 30);
		expect(arcsAt(c, 12.1)).toEqual(first);
	});

	test("a different seed draws something different", async () => {
		const c = controlsOf(await drop());
		const other = arcsLook({ seed: 2, palette: "Ice" });
		expect(arcsAt(c, 12.1, other)).not.toEqual(arcsAt(c, 12.1));
	});

	test("every knob at its limit stays in budget and finite", async () => {
		const c = controlsOf(await drop());
		for (const pick of ["max", "min"] as const) {
			const tuning = Object.fromEntries(
				ARCS_KNOBS.map((k) => [k.key, k[pick]]),
			);
			const look = arcsLook({ seed: 1, palette: "Ice", tuning });
			for (const t of [8.02, 12.1, 30]) {
				const arcs = arcsAt(c, t, look);
				expect(arcs.length).toBeLessThanOrEqual(out.length);
				expect(arcs.every(Number.isFinite)).toBe(true);
			}
		}
	});

	test("a stroke's capsules stay inside the box it's composited in", async () => {
		const c = controlsOf(await drop());
		const { strokes } = buildArcs(
			out,
			table,
			sampleControls(c, 15),
			c,
			LOOK,
			576,
			720,
		);
		expect(strokes).toBeGreaterThan(0);
		for (let s = 0; s < strokes; s++) {
			const row = s * STROKE_FLOATS;
			for (let v = 0; v < table[row + 1]; v++) {
				const o = (table[row] + v) * ARC_FLOATS;
				for (const [x, y] of [
					[out[o + 2], out[o + 3]],
					[out[o + 4], out[o + 5]],
				]) {
					expect(x + 288).toBeGreaterThanOrEqual(table[row + 4]);
					expect(x + 288).toBeLessThanOrEqual(table[row + 6]);
					expect(y + 360).toBeGreaterThanOrEqual(table[row + 5]);
					expect(y + 360).toBeLessThanOrEqual(table[row + 7]);
				}
			}
		}
	});

	test("the brush starts at arcDrawer's defaults", () => {
		expect(LOOK.arcBlur).toBe(6);
		expect(LOOK.arcLength).toBe(10);
		expect(LOOK.arcWidth).toBe(8);
		expect(LOOK.arcDecay).toBe(0.5);
		expect(LOOK.arcWander).toBe(50);
		expect(LOOK.arcMomentum).toBe(0.8);
	});
});

describe("figures", () => {
	const EXTENT = { x: 1, y: 1.25 };

	test("every family comes up before any repeats, and never twice in a row", () => {
		const size = FIGURE_NAMES.length;
		for (const seed of [1, 7, 99, 4242]) {
			const dealt = Array.from({ length: size * 4 }, (_, i) =>
				familyOf(seed, i),
			);
			expect(new Set(dealt.slice(0, size)).size).toBe(size);
			for (let i = 1; i < dealt.length; i++) {
				expect(dealt[i]).not.toBe(dealt[i - 1]);
			}
		}
	});

	test("is fixed by its seed and section", () => {
		const a = figureOf(3, 5, EXTENT, 150, 0.1);
		expect(figureOf(3, 5, EXTENT, 150, 0.1)).toEqual(a);
		expect(figureOf(3, 6, EXTENT, 150, 0.1).seed).not.toBe(a.seed);
	});

	test("keeps near the stroke count it's asked for, whatever the family", () => {
		for (let section = 0; section < FIGURE_NAMES.length; section++) {
			const figure = figureOf(1, section, EXTENT, 150, 0.1);
			const drawn = figure.hairs.length * figure.copies.length;
			expect(drawn).toBeGreaterThan(100);
			expect(drawn).toBeLessThan(220);
		}
	});

	test("the pen visits every stroke in order, from start to end", () => {
		for (let section = 0; section < FIGURE_NAMES.length; section++) {
			const { hairs } = figureOf(1, section, EXTENT, 150, 0.1);
			for (let i = 1; i < hairs.length; i++) {
				expect(hairs[i].pen).toBeGreaterThan(hairs[i - 1].pen);
			}
			expect(hairs[0].pen).toBeGreaterThan(0);
			expect(hairs[hairs.length - 1].pen).toBeLessThan(1);
		}
	});

	test("its copies are one stroke, repeated: same walk, same length", async () => {
		const c = controlsOf(await drop());
		const frame = sampleControls(c, 15);
		const { strokes } = buildArcs(out, table, frame, c, LOOK, 576, 720);
		const figure = figureOf(
			LOOK.seed,
			frame.sectionB,
			{ x: 1, y: 1.25 },
			150,
			0.12,
		);
		const pathLength = (s: number) => {
			const row = s * STROKE_FLOATS;
			let length = 0;
			for (let v = 0; v < table[row + 1]; v += 6) {
				const o = (table[row] + v) * ARC_FLOATS;
				length += Math.hypot(out[o + 4] - out[o + 2], out[o + 5] - out[o + 3]);
			}
			return length;
		};
		const copies = figure.copies.length;
		expect(strokes).toBeGreaterThanOrEqual(copies * 2);
		for (let hair = 0; hair + copies <= strokes; hair += copies) {
			for (let k = 1; k < copies; k++) {
				expect(pathLength(hair + k)).toBeCloseTo(pathLength(hair), 2);
			}
		}
	});
});

describe("the look", () => {
	test("a saved spec can't ask for more than a control allows", () => {
		const spec = normalizeArcsSpec({
			seed: 7,
			palette: "Ice",
			listen: "nope",
			values: { amount: 1e9, reach: -5, nope: 3, roughness: "high" },
			tuning: { arcHairs: 1e9 },
			forms: [1],
		});
		expect(spec).toEqual({
			seed: 7,
			palette: "Ice",
			values: { amount: 100, reach: 0 },
		});
	});

	test("anything that isn't a spec is dropped", () => {
		for (const raw of [null, 3, "x", {}, { seed: "1" }, { seed: NaN }]) {
			expect(normalizeArcsSpec(raw)).toBeUndefined();
		}
	});

	test("an unknown palette falls back", () => {
		expect(normalizeArcsSpec({ seed: 1, palette: "Nope" })?.palette).toBe(
			"Ice",
		);
	});

	test("clamps even a spec that was never normalized", () => {
		const look = arcsLook({
			seed: 1,
			palette: "Ice",
			tuning: { arcLength: 1e9 },
		});
		expect(look.arcLength).toBe(32);
	});

	const at = (values: NonNullable<ArcsSpec["values"]>) =>
		arcsLook({ seed: 1, palette: "Ice", values });

	test("50 is the tuned look, whatever the tuning", () => {
		const tuning = { arcHairs: 170, kickReach: 0.9 };
		const look = arcsLook({ seed: 1, palette: "Ice", tuning });
		const fifties = Object.fromEntries(ARCS_CONTROLS.map((c) => [c.key, 50]));
		expect(
			arcsLook({ seed: 1, palette: "Ice", tuning, values: fifties }),
		).toEqual(look);
		expect(look.arcHairs).toBe(170);
		for (const knob of ARCS_KNOBS) {
			if (knob.key in tuning) continue;
			expect(at({})[knob.key]).toBe(knob.value);
		}
	});

	test("every control moves everything it holds, in range", () => {
		for (const control of ARCS_CONTROLS) {
			const low = at({ [control.key]: 0 });
			const high = at({ [control.key]: 100 });
			const moved = ARCS_KNOBS.filter((k) => low[k.key] !== high[k.key]);
			expect(moved.length).toBeGreaterThanOrEqual(4);
			for (const knob of ARCS_KNOBS) {
				for (const look of [low, high]) {
					expect(look[knob.key]).toBeGreaterThanOrEqual(knob.min);
					expect(look[knob.key]).toBeLessThanOrEqual(knob.max);
				}
			}
		}
	});

	test("reacts to picks the band hits are heard in", () => {
		const look = arcsLook({ seed: 1, palette: "Ice", listen: "hats" });
		expect([look.hitFreqLow, look.hitFreqHigh]).toEqual([6000, 16000]);
		const kick = arcsLook({ seed: 1, palette: "Ice", listen: "kick" });
		expect(kick.hitFreqHigh).toBe(at({}).hitFreqHigh);
	});

	test("the ends of a control are far apart on screen data", async () => {
		const c = controlsOf(await drop());
		const fewest = arcsAt(c, 12.1, at({ amount: 0 })).length;
		const most = arcsAt(c, 12.1, at({ amount: 100 })).length;
		expect(most).toBeGreaterThan(fewest * 5);
	});

	test("roughness keeps its reach: strokes don't stop at the figure", async () => {
		const c = controlsOf(await drop());
		const reachOf = (look: Look) => {
			const v = arcsAt(c, 15, look);
			let far = 0;
			for (let i = 0; i < v.length; i += ARC_FLOATS) {
				far = Math.max(far, Math.hypot(v[i], v[i + 1]));
			}
			return far;
		};
		const combed = reachOf(at({ roughness: 0 }));
		const rough = reachOf(at({ roughness: 100 }));
		expect(rough).toBeGreaterThan(combed * 0.3);
		expect(combed).toBeGreaterThan(rough * 0.3);
	});
});
