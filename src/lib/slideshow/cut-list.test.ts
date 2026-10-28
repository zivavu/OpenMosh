import { describe, expect, test } from "bun:test";
import { cutAt, parseCutList } from "../media/cut-list";
import { beatAtTime } from "./beat-clock";
import { freezeCuts, freezeSlideshow } from "./cut-list";
import { DEFAULT_SLIDESHOW_CONFIG, type SlideshowConfig } from "./types";

const HOLD = Number.MAX_SAFE_INTEGER;

function config(patch: Partial<SlideshowConfig>): SlideshowConfig {
	return { ...DEFAULT_SLIDESHOW_CONFIG, ...patch };
}

/** What the frame driver shows at each sampled time: the slide and its beat. */
function driven(cfg: SlideshowConfig, n: number, start: number, end: number) {
	const out: { t: number; slide: number; beat: number }[] = [];
	let last = -1;
	let slide = 0;
	let beat = 0;
	for (let t = start; t < end; t += 0.001) {
		const { index } = beatAtTime(
			t,
			cfg.bpm,
			cfg.beatOffset,
			cfg.segments,
			cfg.subdivision,
		);
		if (index !== HOLD && index !== last) {
			last = index;
			slide = index % n;
			beat++;
		}
		out.push({ t: t - start, slide, beat });
	}
	return out;
}

function matchesDriver(
	cfg: SlideshowConfig,
	n: number,
	start: number,
	end: number,
) {
	const list = freezeSlideshow({
		config: cfg,
		name: "s",
		sessionKey: "k",
		slideIds: [...Array(n).keys()].map(String),
		span: { start, end },
	});
	const { cuts } = list;
	const seen = new Map<number, number>();
	for (const { t, slide, beat } of driven(cfg, n, start, end)) {
		// Skip float noise right at a beat.
		if (cuts.some(([c]) => Math.abs(c - t) < 0.002)) continue;
		const at = cutAt(list, t);
		expect(at.slideId).toBe(String(slide));
		const tick = seen.get(beat);
		if (tick === undefined) seen.set(beat, at.tick);
		else expect(at.tick).toBe(tick);
	}
	expect(new Set(seen.values()).size).toBe(seen.size);
	return cuts;
}

describe("freezeCuts", () => {
	test("cuts every beat, cycling the slides", () => {
		const cuts = matchesDriver(config({ bpm: 120 }), 3, 0, 4);
		expect(cuts.length).toBe(8);
		expect(cuts.slice(0, 4)).toEqual([
			[0, 0],
			[0.5, 1],
			[1, 2],
			[1.5, 0],
		]);
	});

	test("starts mid-song on the slide playing there", () => {
		const cuts = matchesDriver(
			config({ bpm: 120, beatOffset: 0.2 }),
			4,
			3.1,
			6,
		);
		expect(cuts[0]).toEqual([0, 1]);
	});

	test("follows each segment's subdivision and holds through a stop", () => {
		const cfg = config({
			bpm: 100,
			beatOffset: 0.1,
			segments: [
				{ id: "a", startTime: 1, endTime: 2.3, subdivision: 0.25 },
				{ id: "b", startTime: 2.3, endTime: 3.7, subdivision: 0 },
				{ id: "c", startTime: 3.7, subdivision: 2 },
			],
		});
		matchesDriver(cfg, 5, 0, 8);
	});

	test("opening on a stop shows the first slide", () => {
		const cfg = config({ subdivision: 0 });
		expect(freezeCuts(cfg, 3, { start: 0, end: 10 })).toEqual([[0, 0]]);
	});
});

describe("cut lists", () => {
	const list = freezeSlideshow({
		config: config({ bpm: 120 }),
		name: "Show",
		sessionKey: "slideshow:p:1",
		slideIds: ["a", "b"],
		span: { start: 10, end: 12 },
	});

	test("wrap like a video, counting ticks on across loops", () => {
		expect(cutAt(list, 0.6)).toEqual({
			tick: 1,
			slideId: "b",
			slideTime: 10.6,
		});
		expect(cutAt(list, 2.1)).toEqual({
			tick: 4,
			slideId: "a",
			slideTime: 10.1,
		});
	});

	test("survive a round trip through their file", () => {
		expect(parseCutList(JSON.stringify(list))).toEqual(list);
	});

	test("refuse a crafted file", () => {
		const bad = (patch: object) =>
			parseCutList(JSON.stringify({ ...list, ...patch }));
		expect(bad({ cuts: [[0, 2]] })).toBeNull();
		expect(
			bad({
				cuts: [
					[0, 0],
					[1, 1],
					[0.5, 0],
				],
			}),
		).toBeNull();
		expect(bad({ cuts: [[0.1, 0]] })).toBeNull();
		expect(bad({ cuts: [] })).toBeNull();
		expect(bad({ duration: 0 })).toBeNull();
		expect(bad({ bpm: -1 })).toBeNull();
		expect(bad({ slides: [1] })).toBeNull();
		expect(bad({ version: 2 })).toBeNull();
		expect(parseCutList("{")).toBeNull();
		expect(parseCutList("null")).toBeNull();
	});
});
