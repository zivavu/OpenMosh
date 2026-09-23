import { describe, expect, it } from "bun:test";
import { mediaLayerSides, resolveMediaLayersAt } from "./resolve";
import {
	createTransition,
	normalizeClipTransition,
	resolveConcreteTransition,
	transitionLength,
} from "./transition";
import {
	createMediaClip,
	createMediaLane,
	normalizeMediaTimeline,
	splitMediaClipAt,
	type MediaLane,
} from "./types";

function lane(spans: [number, number][]): MediaLane {
	const l = createMediaLane("Layer 1", "src-a");
	l.clips = spans.map(([s, e]) => createMediaClip(s, e));
	return l;
}

const at = (l: MediaLane, time: number) =>
	resolveMediaLayersAt({ enabled: true, lanes: [l] }, time)[0];

describe("resolving a blend", () => {
	it("blends in from the clip that touches it, which plays on", () => {
		const l = lane([
			[0, 2],
			[2, 4],
		]);
		l.clips[1].transition = { ...createTransition("whip"), durationSec: 1 };
		const layer = at(l, 2.25);
		expect(layer.clipId).toBe(l.clips[1].id);
		expect(layer.transition?.progress).toBeCloseTo(0.25);
		expect(layer.transition?.from?.clipId).toBe(l.clips[0].id);
		expect(layer.transition?.from?.sourceTime).toBeCloseTo(2.25);
		expect(at(l, 3.1).transition).toBeUndefined();
	});

	it("puts the two sides on different textures, and keeps each clip's across the blend", () => {
		const l = lane([
			[0, 2],
			[2, 4],
		]);
		l.clips[1].transition = createTransition("slam");
		const before = at(l, 1.9);
		const during = at(l, 2.1);
		const sides = mediaLayerSides([during]).map((s) => s.key);
		expect(new Set(sides).size).toBe(2);
		expect(during.transition?.from?.key).toBe(before.key);
		expect(at(l, 3).key).toBe(during.key);
	});

	it("keeps the lane's texture across a plain cut", () => {
		const l = lane([
			[0, 2],
			[2, 4],
		]);
		expect(at(l, 3).key).toBe(at(l, 1).key);
	});

	it("blends in from nothing after a gap", () => {
		const l = lane([
			[0, 1],
			[2, 4],
		]);
		l.clips[1].transition = createTransition("burn");
		const layer = at(l, 2.1);
		expect(layer.transition?.from).toBeNull();
		expect(layer.key).toBe(at(l, 0.5).key);
	});

	it("never runs past the clip's end", () => {
		const clip = createMediaClip(0, 0.3);
		clip.transition = { ...createTransition("cube"), durationSec: 2 };
		expect(transitionLength(clip)).toBeCloseTo(0.3);
	});
});

describe("random picks", () => {
	it("land the same way for the same clip", () => {
		const t = createTransition("random");
		expect(resolveConcreteTransition(t, 3)).toEqual(
			resolveConcreteTransition(t, 3),
		);
		expect(resolveConcreteTransition(t, 3)?.type).not.toBe("random");
	});

	it("a cut renders nothing", () => {
		expect(resolveConcreteTransition(createTransition("cut"), 0)).toBeNull();
	});
});

describe("saving", () => {
	it("drops cuts and retired names, fills what's missing", () => {
		expect(normalizeClipTransition({ type: "cut" })).toBeUndefined();
		expect(normalizeClipTransition({ type: "dissolve" })).toBeUndefined();
		expect(normalizeClipTransition({ type: "whip" })).toMatchObject({
			type: "whip",
			durationSec: 0.5,
		});
	});

	it("survives a round trip through the timeline", () => {
		const l = lane([[0, 2]]);
		l.clips[0].transition = createTransition("shatter");
		const t = normalizeMediaTimeline(
			JSON.parse(JSON.stringify({ enabled: true, lanes: [l] })),
		);
		expect(t.lanes[0].clips[0].transition?.type).toBe("shatter");
	});

	it("isn't copied onto the right half of a split", () => {
		const l = lane([[0, 2]]);
		l.clips[0].transition = createTransition("whip");
		const [left, right] = splitMediaClipAt(l, 1).clips;
		expect(left.transition?.type).toBe("whip");
		expect(right.transition).toBeUndefined();
	});
});
