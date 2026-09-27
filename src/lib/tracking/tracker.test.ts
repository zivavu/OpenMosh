import { describe, expect, test } from "bun:test";
import { computeSaliency } from "./saliency";
import { readTrackingParams, syncBoxes, trackBoxes } from "./tracker";
import type { TrackingState } from "./types";

const GW = 128;
const GH = 72;
const TICK = 0.12;

interface Scene {
	x: number;
	y: number;
	gain?: number;
	visible?: boolean;
}

/** A textured object over a soft gradient, placed at a fractional cell. */
function frame({ x, y, gain = 1, visible = true }: Scene): Float32Array {
	const lum = new Float32Array(GW * GH);
	for (let row = 0; row < GH; row++) {
		for (let col = 0; col < GW; col++) {
			let v = 0.3 + (col / GW) * 0.05;
			const u = col - x;
			const w = row - y;
			if (visible && Math.abs(u) < 6 && Math.abs(w) < 6) {
				v =
					0.5 +
					0.25 * Math.sin(u * 1.3) * Math.cos(w * 0.9) +
					0.15 * Math.sin((u + w) * 0.7);
			}
			lum[row * GW + col] = v * gain;
		}
	}
	return lum;
}

function newState(): TrackingState {
	return {
		boxes: [],
		salPoints: [],
		lastAnalyze: -1,
		lastTick: -1,
		signature: "",
		prevLum: null,
		gridW: 0,
		gridH: 0,
		disturbance: 0,
		primaryKey: -1,
	};
}

const params = readTrackingParams({ count: 1 });

/** Run the renderer's per-tick sequence over a path. `drift` is how far the box
 * slid off the spot it first locked on the target, in cells. */
function run(path: Scene[]) {
	const state = newState();
	const seen = new Set<string>();
	let lockX = 0;
	let lockY = 0;
	path.forEach((scene, i) => {
		const t = i * TICK;
		const lum = frame(scene);
		state.salPoints = computeSaliency(lum, GW, GH, params);
		trackBoxes(state, lum, GW, GH, t);
		syncBoxes(state, params, t);
		const box = state.boxes[0];
		seen.add(box.state);
		if (i === 0) {
			lockX = box.baseX * (GW - 1) - scene.x;
			lockY = box.baseY * (GH - 1) - scene.y;
		}
	});
	const box = state.boxes[0];
	const last = path[path.length - 1];
	const drift = Math.hypot(
		box.baseX * (GW - 1) - last.x - lockX,
		box.baseY * (GH - 1) - last.y - lockY,
	);
	return { box, drift, seen };
}

function path(n: number, at: (i: number) => Scene): Scene[] {
	return Array.from({ length: n }, (_, i) => at(i));
}

describe("computeSaliency", () => {
	test("picks texture a box can hold over a straight edge it would slide along", () => {
		const lum = frame({ x: 90, y: 36 });
		// A hard, bright vertical edge: the strongest gradient in the frame.
		for (let row = 0; row < GH; row++) {
			for (let col = 20; col < 40; col++) lum[row * GW + col] = 1;
		}
		const [first] = computeSaliency(lum, GW, GH, params);
		expect(Math.abs(first.x * (GW - 1) - 90)).toBeLessThan(6);
	});

	test("never picks a letterbox bar's edge", () => {
		const lum = frame({ x: 60, y: 36 });
		for (let row = 0; row < GH; row++) {
			if (row >= 12 && row < GH - 12) continue;
			for (let col = 0; col < GW; col++) lum[row * GW + col] = 0;
		}
		const picks = computeSaliency(
			lum,
			GW,
			GH,
			readTrackingParams({ count: 5 }),
		);
		expect(picks.length).toBeGreaterThan(0);
		for (const p of picks) {
			const row = p.y * (GH - 1);
			expect(row).toBeGreaterThan(12 + 4);
			expect(row).toBeLessThan(GH - 12 - 4);
		}
	});
});

describe("trackBoxes", () => {
	test("follows a target that moves less than a cell per tick", () => {
		const { box, drift } = run(
			path(60, (i) => ({ x: 30 + i * 0.3, y: 30 + i * 0.1 })),
		);
		expect(box.state).toBe("lock");
		expect(drift).toBeLessThan(1.5);
	});

	test("keeps up with a fast target", () => {
		const { box, drift } = run(path(20, (i) => ({ x: 15 + i * 4.5, y: 36 })));
		expect(box.state).toBe("lock");
		expect(drift).toBeLessThan(1.5);
	});

	test("holds the lock through a brightness change", () => {
		const { box, drift } = run(
			path(30, (i) => ({ x: 40 + i, y: 36, gain: i < 10 ? 1 : 0.55 })),
		);
		expect(box.state).toBe("lock");
		expect(drift).toBeLessThan(1.5);
	});

	test("finds its target again after losing it", () => {
		const { box, drift, seen } = run([
			...path(8, (i) => ({ x: 40 + i, y: 36 })),
			...path(6, () => ({ x: 48, y: 36, visible: false })),
			...path(30, (i) => ({ x: 52 + i * 0.5, y: 38 })),
		]);
		expect(seen.has("lost")).toBe(true);
		expect(box.state).toBe("lock");
		expect(drift).toBeLessThan(1.5);
	});
});
