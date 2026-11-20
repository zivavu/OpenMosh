import { describe, expect, test } from "bun:test";
import { trackingFrameSignature } from "./render-tracking";
import { computeSaliency } from "./saliency";
import {
	readTrackingParams,
	resolveFrame,
	syncBoxes,
	trackBoxes,
} from "./tracker";
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
		expect(first.w).toBeGreaterThan(0);
		expect(first.h).toBeGreaterThan(0);
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

	test("light mode locks onto bright luminous blobs over midtone texture", () => {
		const lum = new Float32Array(GW * GH).fill(0.25);
		// Midtone textured patch at left; bright smooth orb at right.
		for (let row = 28; row < 44; row++) {
			for (let col = 22; col < 38; col++) {
				lum[row * GW + col] =
					0.35 + 0.12 * Math.sin(col * 1.4) * Math.cos(row * 1.4);
			}
		}
		for (let row = 0; row < GH; row++) {
			for (let col = 0; col < GW; col++) {
				if (Math.hypot(col - 92, row - 36) < 7) lum[row * GW + col] = 0.96;
			}
		}
		const [first] = computeSaliency(
			lum,
			GW,
			GH,
			readTrackingParams({ count: 1, hudFollow: "light" }),
		);
		expect(first).toBeDefined();
		expect(
			Math.hypot(first.x * (GW - 1) - 92, first.y * (GH - 1) - 36),
		).toBeLessThan(6);
	});

	test("motion mode picks the region that moved between frames", () => {
		const prev = new Float32Array(GW * GH).fill(0.2);
		const curr = new Float32Array(GW * GH).fill(0.2);
		// Static bright texture on the left; small moving dot on the right.
		for (let row = 30; row < 42; row++) {
			for (let col = 24; col < 36; col++) {
				const v = 0.7 + 0.2 * Math.sin(col * 1.3) * Math.cos(row * 1.3);
				prev[row * GW + col] = v;
				curr[row * GW + col] = v;
			}
		}
		for (let row = 32; row < 40; row++) {
			for (let col = 86; col < 94; col++) prev[row * GW + col] = 0.85;
			for (let col = 92; col < 100; col++) curr[row * GW + col] = 0.85;
		}
		const [first] = computeSaliency(
			curr,
			GW,
			GH,
			readTrackingParams({ count: 1, hudFollow: "motion" }),
			prev,
		);
		expect(first).toBeDefined();
		expect(first.x * (GW - 1)).toBeGreaterThan(80);
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

describe("HUD controls & resolveFrame", () => {
	test("readTrackingParams migrates legacy color keywords and clamps textSize at 0", () => {
		expect(readTrackingParams({ color: "white" }).color).toBe("#ffffff");
		expect(readTrackingParams({ color: "black" }).color).toBe("#000000");
		expect(readTrackingParams({ color: "#4de6ff" }).color).toBe("#4de6ff");
		expect(readTrackingParams({ textSize: -5 }).textSize).toBe(0);
		expect(readTrackingParams({ textSize: 0 }).textSize).toBe(0);
		expect(readTrackingParams({ crosshair: 0 }).crosshair).toBe(false);
		expect(readTrackingParams({ crosshair: 1 }).crosshair).toBe(true);
	});

	test("designates a primary target immediately and hides all labels when textSize is 0", () => {
		const state = newState();
		const lum = frame({ x: 64, y: 36 });
		const p = readTrackingParams({ count: 2, textSize: 18, labels: "full" });
		state.salPoints = computeSaliency(lum, GW, GH, p);
		syncBoxes(state, p, 0);
		expect(state.primaryKey).toBe(0);

		const withText = resolveFrame(state, 0, 1280, 720, p);
		expect(withText.boxes[0].primary).toBe(true);
		expect(withText.boxes[0].label).toContain("TGT");
		expect(withText.boxes[0].sub).toContain("X ");

		const noText = resolveFrame(
			state,
			0,
			1280,
			720,
			readTrackingParams({ count: 2, textSize: 0 }),
		);
		for (const box of noText.boxes) {
			expect(box.label).toBe("");
			expect(box.sub).toBe("");
		}

		const coordsOnly = resolveFrame(
			state,
			0,
			1280,
			720,
			readTrackingParams({ count: 2, textSize: 18, labels: "coords" }),
		);
		expect(coordsOnly.boxes[0].label).toMatch(/^\d{4}, \d{4}$/);
		expect(coordsOnly.boxes[0].sub).toBe("");
	});

	test("trackingFrameSignature invalidates when any HUD visual control changes", () => {
		const state = newState();
		const lum = frame({ x: 64, y: 36 });
		const base = readTrackingParams({ count: 1 });
		state.salPoints = computeSaliency(lum, GW, GH, base);
		syncBoxes(state, base, 0);
		const fr = resolveFrame(state, 0, 1280, 720, base);

		const sig0 = trackingFrameSignature(fr, base, 0, 1280, 720);
		expect(
			trackingFrameSignature(fr, { ...base, textSize: 0 }, 0, 1280, 720),
		).not.toBe(sig0);
		expect(
			trackingFrameSignature(fr, { ...base, hudStyle: "box" }, 0, 1280, 720),
		).not.toBe(sig0);
		expect(
			trackingFrameSignature(fr, { ...base, links: 0 }, 0, 1280, 720),
		).not.toBe(sig0);
		expect(
			trackingFrameSignature(fr, { ...base, crosshair: false }, 0, 1280, 720),
		).not.toBe(sig0);
		expect(
			trackingFrameSignature(fr, { ...base, color: "#4de6ff" }, 0, 1280, 720),
		).not.toBe(sig0);
	});
});
