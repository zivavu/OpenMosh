import { describe, expect, it } from "bun:test";
import { createEffectInstance, getDefinition } from "./effects";
import { paramValueAt, setParamKey } from "./effects/param-keys";
import { ParamTakes } from "./effects/param-take";
import { KeyTake, type TakeSamples } from "./key-take";
import { simplifyKeys, writeTake, type Keyframe } from "./keyframes";
import { DEFAULT_MEDIA_STYLE, type MediaLane } from "./media";
import { toggleLaneKey } from "./media/lane-keys";
import { PlacementTakes } from "./media/placement-take";
import type { EffectInstance } from "./effects/types";

/** Frames run by hand. */
function frames() {
	let queued: (() => void) | null = null;
	return {
		frame: (cb: () => void) => {
			queued = cb;
			return 1;
		},
		run() {
			const cb = queued;
			queued = null;
			cb?.();
		},
	};
}

describe("simplifyKeys", () => {
	it("thins a straight sweep to its ends and keeps the corners", () => {
		const ramp = Array.from({ length: 61 }, (_, i) => ({ t: i / 60, v: i }));
		expect(simplifyKeys(ramp, 0.5)).toHaveLength(2);
		const tent = Array.from({ length: 61 }, (_, i) => ({
			t: i / 60,
			v: 30 - Math.abs(30 - i),
		}));
		expect(simplifyKeys(tent, 0.5).map((k) => k.v)).toEqual([0, 30, 0]);
	});

	it("keeps keys with an ease of their own", () => {
		const keys: Keyframe<number>[] = [
			{ t: 0, v: 0 },
			{ t: 1, v: 1, ease: "hold" },
			{ t: 2, v: 2 },
		];
		expect(simplifyKeys(keys, 10)).toHaveLength(3);
	});
});

describe("writeTake", () => {
	it("replaces the keys inside the pass and keeps the rest", () => {
		const base = [0, 1, 2, 3].map((t) => ({ t, v: 0 }));
		const out = writeTake(base, [
			{ t: 0.9, v: 5 },
			{ t: 2.1, v: 5 },
		]);
		expect(out.map((k) => [k.t, k.v])).toEqual([
			[0, 0],
			[0.9, 5],
			[2.1, 5],
			[3, 0],
		]);
	});
});

describe("KeyTake", () => {
	it("records a held value every frame, and thins it on release", () => {
		const f = frames();
		let t = 0;
		const writes: { samples: TakeSamples<"a">; final: boolean }[] = [];
		const take = new KeyTake<"a">({
			now: () => t,
			apply: (samples, final) => writes.push({ samples, final }),
			frame: f.frame,
			cancelFrame: () => {},
		});
		take.set({ a: 1 });
		for (let i = 0; i < 10; i++) {
			t += 0.1;
			f.run();
		}
		take.end();
		const last = writes[writes.length - 1];
		expect(last.final).toBe(true);
		expect(last.samples.a).toHaveLength(11);
		expect(last.samples.a!.every((k) => k.v === 1)).toBe(true);
	});

	it("ignores a playhead that loops back", () => {
		const f = frames();
		let t = 5;
		let samples: TakeSamples<"a"> = {};
		const take = new KeyTake<"a">({
			now: () => t,
			apply: (s) => (samples = s),
			frame: f.frame,
			cancelFrame: () => {},
		});
		take.set({ a: 1 });
		t = 0;
		f.run();
		expect(samples.a!.map((k) => k.t)).toEqual([5]);
	});
});

describe("ParamTakes", () => {
	function keyed(): EffectInstance {
		const e = createEffectInstance(getDefinition("posterize")!);
		return setParamKey({ ...e, enabled: true }, "levels", 0, 4);
	}

	it("turns a slider held through playback into one pass of a few keys", () => {
		const f = frames();
		let effects = [keyed()];
		let t = 1;
		let held = true;
		let edits = 0;
		const takes = new ParamTakes({
			effects: () => effects,
			replace: (i, e) => (effects = effects.map((x, j) => (j === i ? e : x))),
			beforeEdit: () => edits++,
			afterEdit: () => {},
			time: () => t,
			playing: () => true,
			held: () => held,
			frame: f.frame,
		});
		// A steady sweep from 4 to 20 over two seconds, a tick per frame.
		for (let i = 0; i <= 120; i++) {
			t = 1 + i / 60;
			expect(takes.edit(0, "levels", 4 + (16 * i) / 120)).toBe(true);
			f.run();
		}
		held = false;
		takes.dispose();
		expect(edits).toBe(1);
		const keys = effects[0].keys!.levels;
		expect(keys.length).toBeLessThan(5);
		expect(paramValueAt(effects[0], "levels", 2)).toBe(12);
	});

	it("leaves a paused or unheld slider to the usual keying", () => {
		const effects = [keyed()];
		const host = {
			effects: () => effects,
			replace: () => {},
			beforeEdit: () => {},
			afterEdit: () => {},
			time: () => 1,
		};
		expect(
			new ParamTakes({ ...host, playing: () => false, held: () => true }).edit(
				0,
				"levels",
				9,
			),
		).toBe(false);
		expect(
			new ParamTakes({ ...host, playing: () => true, held: () => false }).edit(
				0,
				"levels",
				9,
			),
		).toBe(false);
	});
});

describe("PlacementTakes", () => {
	it("records a held keyed placement and writes the rest as it is", () => {
		const f = frames();
		let lane: MediaLane = toggleLaneKey(
			{
				id: "l",
				name: "Media 1",
				enabled: true,
				z: 0,
				sourceId: "s",
				style: { ...DEFAULT_MEDIA_STYLE },
				clips: [],
			},
			"x",
			0,
			false,
		);
		let t = 0;
		const takes = new PlacementTakes({
			lane: () => lane,
			setLane: (_, edit) => (lane = edit(lane)),
			beforeEdit: () => {},
			time: () => t,
			playing: () => true,
			held: () => true,
			frame: f.frame,
		});
		for (let i = 1; i <= 30; i++) {
			t = i / 30;
			takes.edit("l", { ...lane.style, x: 0.5 + i / 100, scale: 2 });
			f.run();
		}
		takes.dispose();
		expect(lane.style.scale).toBe(2);
		expect(lane.keys!.x!.length).toBeLessThanOrEqual(3);
		expect(lane.keys!.x!.at(-1)!.v).toBeCloseTo(0.8);
	});
});
