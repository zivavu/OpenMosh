import { describe, expect, test } from "bun:test";
import { analyzeDrive } from "./analyze";
import {
	buildControls,
	findCuts,
	sampleControls,
	type Controls,
	type SongAudio,
} from "./controls";
import {
	allForms,
	ARCS_CONTROLS,
	ARCS_KNOBS,
	arcsLook,
	normalizeArcsSpec,
	type ArcsSpec,
	type Look,
} from "./look";
import { moodOf } from "./mood";
import { ARC_FLOATS, buildArcs, MAX_ARC_VERTICES } from "./strokes";
import { isArcsFile, newArcsFile, readArcsFile } from "./file";
import { controlsFor } from "./song";
import {
	createMediaClip,
	normalizeMediaTimeline,
	resolveMediaLayersAt,
	type MediaTimeline,
} from "../media";

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
	return buildControls(song, arcsLook({ seed, palette: "Ice" }), allForms());
}

const LOOK = arcsLook({ seed: 1, palette: "Ice" });
const VIEW = [1.5, 0, 0, 0, 0, 1.5, 0, 0, 0, 0, -1, -1, 0, 0, 3, 3.5];
const out = new Float32Array(MAX_ARC_VERTICES * ARC_FLOATS);

function arcsAt(c: Controls, t: number, look = LOOK) {
	const count = buildArcs(
		out,
		sampleControls(c, t),
		c,
		look,
		VIEW,
		3.5,
		576,
		720,
	);
	return out.slice(0, count * ARC_FLOATS);
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
		expect(sampleControls(c, 7.9).kickAge).toBeGreaterThan(100);
		expect(sampleControls(c, 8.1).kickAge).toBeCloseTo(0.1, 1);
	});

	test("forms change on a hit and sections count up", async () => {
		const c = controlsOf(await drop());
		expect(c.cuts.length).toBeGreaterThan(1);
		for (const cut of c.cuts) expect(c.onsets).toContain(cut);
		const last = sampleControls(c, 39.9);
		expect(last.sectionB).toBe(c.cuts.length);
	});

	test("stays on one form when only one is allowed", async () => {
		const c = buildControls(
			await drop(),
			arcsLook({ seed: 1, palette: "Ice" }),
			[5],
		);
		expect(new Set(c.formA)).toEqual(new Set([5]));
		expect(new Set(c.formB)).toEqual(new Set([5]));
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
		buildControls(await drop(), listening(tuning), allForms()).onsets;

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
			buildControls(
				song,
				listening({ hitFreqLow, hitFreqHigh }),
				allForms(),
			).onsets.map((f) => (f / 60) % 1);
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
			const c = buildControls(song, listening({ hitSmooth }), allForms());
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

	test("a listening knob gets its own table, a picture knob doesn't", async () => {
		const song = await drop();
		const base = controlsFor(song, listening({}));
		expect(controlsFor(song, listening({ hitSense: 0.9 }))).not.toBe(base);
		expect(controlsFor(song, listening({ bloom: 0.9 }))).toBe(base);
	});
});

describe("arcs", () => {
	test("none in silence, and a burst on the hit", async () => {
		const c = controlsOf(await drop());
		expect(arcsAt(c, 4).length).toBe(0);
		const before = arcsAt(c, 11.99).length;
		const after = arcsAt(c, 12.05).length;
		expect(after).toBeGreaterThan(before);
	});

	test("a moment draws the same however the playhead got there", async () => {
		const c = controlsOf(await drop());
		const first = arcsAt(c, 12.1);
		arcsAt(c, 3);
		arcsAt(c, 30);
		expect(arcsAt(c, 12.1)).toEqual(first);
	});

	test("a different seed draws different arcs", async () => {
		const song = await drop();
		const other = arcsLook({ seed: 2, palette: "Ice" });
		expect(arcsAt(controlsOf(song, 2), 12.1, other)).not.toEqual(
			arcsAt(controlsOf(song), 12.1),
		);
	});

	test("subarcs add branches, and 0 turns them off", async () => {
		const c = controlsOf(await drop());
		const off = arcsLook({
			seed: 1,
			palette: "Ice",
			tuning: { arcSub: 0, arcSubDepth: 1 },
		});
		const on = arcsLook({ seed: 1, palette: "Ice", tuning: { arcSub: 4 } });
		expect(arcsAt(c, 12.1, on).length).toBeGreaterThan(
			arcsAt(c, 12.1, off).length,
		);
	});

	test("the amount at 0 draws nothing", async () => {
		const c = controlsOf(await drop());
		const none = arcsLook({
			seed: 1,
			palette: "Ice",
			tuning: { arcAmount: 0 },
		});
		expect(arcsAt(c, 12.1, none).length).toBe(0);
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

	test("lines stay thin close to the camera", async () => {
		const c = controlsOf(await drop());
		const near = [...VIEW];
		near[14] = 0.6;
		near[15] = 0.8;
		const count = buildArcs(
			out,
			sampleControls(c, 12.1),
			c,
			LOOK,
			near,
			0.8,
			576,
			720,
		);
		for (let i = 0; i < count; i++) {
			expect(out[i * ARC_FLOATS + 3]).toBeLessThanOrEqual(LOOK.arcWidth * 3);
		}
	});
});

describe("arc lifetime", () => {
	test("a longer life keeps a volley on screen", async () => {
		const c = controlsOf(await drop());
		// Past the default life, before the next beat's volley matters: fewer arcs.
		const short = arcsLook({
			seed: 1,
			palette: "Ice",
			tuning: { arcLife: 0.3 },
		});
		const long = arcsLook({ seed: 1, palette: "Ice", tuning: { arcLife: 3 } });
		expect(arcsAt(c, 12.4, long).length).toBeGreaterThan(
			arcsAt(c, 12.4, short).length,
		);
	});
});

describe("moods", () => {
	test("a section's mood is fixed by its seed and number", () => {
		expect(moodOf(3, 5, 1)).toEqual(moodOf(3, 5, 1));
		expect(moodOf(3, 5, 1)).not.toEqual(moodOf(3, 6, 1));
	});

	test("no variety leaves every section the same", () => {
		expect(moodOf(3, 5, 0)).toEqual(moodOf(9, 2, 0));
		expect(moodOf(3, 5, 0).shape).toEqual([1, 1, 1, 1]);
	});
});

describe("the look", () => {
	test("a saved spec can't ask for more than a control allows", () => {
		const spec = normalizeArcsSpec({
			seed: 7,
			palette: "Ice",
			listen: "nope",
			values: { amount: 1e9, reach: -5, nope: 3, roughness: "high" },
			tuning: { arcKick: 1e9 },
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
		expect(look.arcLength).toBe(64);
	});

	const at = (values: NonNullable<ArcsSpec["values"]>) =>
		arcsLook({ seed: 1, palette: "Ice", values });

	test("50 is the tuned look, whatever the tuning", () => {
		const tuning = { arcKick: 17, kickFlash: 1.3 };
		const look = arcsLook({ seed: 1, palette: "Ice", tuning });
		const fifties = Object.fromEntries(ARCS_CONTROLS.map((c) => [c.key, 50]));
		expect(
			arcsLook({ seed: 1, palette: "Ice", tuning, values: fifties }),
		).toEqual(look);
		expect(look.arcKick).toBe(17);
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

	test("roughness keeps its reach: lightning doesn't stop at the middle", async () => {
		const c = controlsOf(await drop());
		const reachOf = (look: Look) => {
			const v = arcsAt(c, 12.1, look);
			let far = 0;
			for (let i = 0; i < v.length; i += ARC_FLOATS) {
				far = Math.max(far, Math.hypot(v[i], v[i + 1]));
			}
			return far;
		};
		const silky = reachOf(at({ roughness: 0 }));
		const jagged = reachOf(at({ roughness: 100 }));
		expect(jagged).toBeGreaterThan(silky * 0.3);
		expect(silky).toBeGreaterThan(jagged * 0.3);
	});
});

describe("the pool file", () => {
	test("reads back the look it was made with", async () => {
		const file = newArcsFile();
		expect(isArcsFile(file)).toBe(true);
		expect(await readArcsFile(file)).toEqual(JSON.parse(await file.text()));
	});

	test("two sources never share a name", () => {
		const names = new Set(Array.from({ length: 50 }, () => newArcsFile().name));
		expect(names.size).toBeGreaterThan(45);
	});

	test("a damaged or oversized file reads as nothing", async () => {
		const bad = (text: string) => new File([text], "x.arcs.json");
		expect(await readArcsFile(bad("not json"))).toBeNull();
		expect(await readArcsFile(bad("[1,2]"))).toBeNull();
		expect(await readArcsFile(bad(" ".repeat(70 * 1024)))).toBeNull();
	});
});

describe("on a clip", () => {
	const clipOf = (values: object) => ({
		...createMediaClip(10, 20),
		...values,
	});
	const timeline = (clip: object) =>
		({
			enabled: true,
			lanes: [
				{
					id: "lane",
					name: "Lane",
					z: 0,
					enabled: true,
					sourceId: "arcs",
					clips: [clip],
					style: { opacity: 1 },
				},
			],
		}) as unknown as MediaTimeline;

	test("a layer knows the playhead and the clip's own look", () => {
		const arcs = { seed: 9, palette: "Ice" };
		const [layer] = resolveMediaLayersAt(
			timeline(clipOf({ arcs, sourceStart: 3 })),
			15,
		);
		expect(layer.arcs).toEqual(arcs);
		expect(layer.timelineTime).toBe(15);
	});

	test("the look survives a save, and a damaged one is dropped", () => {
		const kept = normalizeMediaTimeline(
			timeline(clipOf({ arcs: { seed: 9, palette: "Ice" } })),
		);
		expect(kept?.lanes[0].clips[0].arcs).toEqual({ seed: 9, palette: "Ice" });
		const damaged = normalizeMediaTimeline(
			timeline(clipOf({ arcs: { seed: "no" } })),
		);
		expect(damaged?.lanes[0].clips[0].arcs).toBeUndefined();
	});
});

describe("the table cache", () => {
	test("one table per seed", async () => {
		const song = await drop();
		const look = arcsLook({ seed: 4, palette: "Ice" });
		expect(controlsFor(song, look)).toBe(controlsFor(song, look));
		const other = arcsLook({ seed: 5, palette: "Ice" });
		expect(controlsFor(song, other)).not.toBe(controlsFor(song, look));
	});
});
