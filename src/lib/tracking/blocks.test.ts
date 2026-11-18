import { describe, expect, test } from "bun:test";
import {
	activityMap,
	analyzeBlocks,
	buildLinkRibbons,
	detectBlocks,
	easeBlocks,
	LINK_SEGMENTS,
	newBlocksState,
	RIBBON_FLOATS,
	RIBBON_MAX_FLOATS,
	type BlockGrid,
} from "./blocks";
import { readTrackingParams } from "./tracker";

const GW = 128;
const GH = 72;
const ASPECT = 16 / 9;

/** Night sky: a dense burst around (bx, by) in cells plus a few lone sparks. */
function sky(bx = 40, by = 36, sparks: [number, number][] = []): BlockGrid {
	const mean = new Float32Array(GW * GH).fill(0.03);
	const peak = new Float32Array(GW * GH).fill(0.05);
	for (let y = 0; y < GH; y++) {
		for (let x = 0; x < GW; x++) {
			if (Math.hypot(x - bx, y - by) < 14) {
				mean[y * GW + x] = 0.5;
				peak[y * GW + x] = 1;
			}
		}
	}
	for (const [x, y] of sparks) {
		mean[y * GW + x] = 0.3;
		peak[y * GW + x] = 1;
	}
	return { mean, peak, gw: GW, gh: GH };
}

const params = readTrackingParams({ mode: "blocks" });

function centerCell(b: { x0: number; x1: number; y0: number; y1: number }) {
	return [((b.x0 + b.x1) / 2) * GW, ((b.y0 + b.y1) / 2) * GH];
}

describe("detectBlocks", () => {
	test("stacks big blocks on the burst and scatters small ones on sparks", () => {
		const sparks: [number, number][] = [
			[100, 10],
			[110, 50],
			[90, 62],
		];
		const grid = sky(40, 36, sparks);
		const rects = detectBlocks(
			grid,
			activityMap(grid, null, params),
			ASPECT,
			params,
		);
		expect(rects.length).toBeGreaterThan(5);
		expect(rects.length).toBeLessThanOrEqual(params.blocks);
		const big = rects.filter((r) => r.level === 0);
		expect(big.length).toBeGreaterThan(0);
		for (const r of big) {
			const [cx, cy] = centerCell(r);
			expect(Math.hypot(cx - 40, cy - 36)).toBeLessThan(16);
		}
		for (const [sx, sy] of sparks) {
			const hit = rects.some((r) => {
				const [cx, cy] = centerCell(r);
				return r.level >= 2 && Math.hypot(cx - sx, cy - sy) < 4;
			});
			expect(hit).toBe(true);
		}
	});

	test("finds nothing on a black frame", () => {
		const grid: BlockGrid = {
			mean: new Float32Array(GW * GH),
			peak: new Float32Array(GW * GH),
			gw: GW,
			gh: GH,
		};
		const act = activityMap(grid, null, params);
		expect(detectBlocks(grid, act, ASPECT, params)).toEqual([]);
	});

	test("motion needs a previous frame, then follows what moved", () => {
		const motion = readTrackingParams({ mode: "blocks", follow: "motion" });
		const a = sky(40, 36);
		expect(activityMap(a, null, motion).some((v) => v > 0)).toBe(false);
		const b = sky(80, 36);
		const rects = detectBlocks(
			b,
			activityMap(b, a.mean, motion),
			ASPECT,
			motion,
		);
		expect(rects.length).toBeGreaterThan(0);
	});

	test("respects the block budget", () => {
		const few = readTrackingParams({ mode: "blocks", blocks: 6 });
		const grid = sky(40, 36, [
			[100, 10],
			[110, 50],
		]);
		const act = activityMap(grid, null, few);
		expect(detectBlocks(grid, act, ASPECT, few).length).toBeLessThanOrEqual(6);
	});
});

describe("analyzeBlocks", () => {
	test("a burst that drifts keeps its blocks' identities", () => {
		const state = newBlocksState();
		analyzeBlocks(state, sky(40, 36), ASPECT, params, 0);
		const ids = new Set(
			state.blocks.filter((b) => b.level === 0).map((b) => b.id),
		);
		expect(ids.size).toBeGreaterThan(0);
		analyzeBlocks(state, sky(41, 36), ASPECT, params, 0.06);
		const kept = state.blocks.filter((b) => b.level === 0 && ids.has(b.id));
		expect(kept.length).toBeGreaterThan(0);
	});

	test("drawn rects glide toward their targets and snap on a jump back", () => {
		const state = newBlocksState();
		analyzeBlocks(state, sky(40, 36), ASPECT, params, 0);
		easeBlocks(state, 0);
		const b = state.blocks[0];
		b.x0 += 0.1;
		easeBlocks(state, 0.016);
		expect(b.dx0).toBeGreaterThan(b.x0 - 0.1);
		expect(b.dx0).toBeLessThan(b.x0);
		easeBlocks(state, 0);
		expect(b.dx0).toBe(b.x0);
	});
});

describe("buildLinkRibbons", () => {
	const W = 1280;
	const H = 720;
	const linked = readTrackingParams({ mode: "blocks", links: 1 });
	const out = new Float32Array(RIBBON_MAX_FLOATS);

	function linkedState() {
		const state = newBlocksState();
		analyzeBlocks(
			state,
			sky(40, 36, [
				[100, 10],
				[110, 50],
			]),
			ASPECT,
			linked,
			0,
		);
		return state;
	}

	test("runs each curve from one pinned point to the other", () => {
		const state = linkedState();
		expect(state.links.length).toBeGreaterThan(0);
		const verts = buildLinkRibbons(state, W, H, 3, 10, out);
		const perLink = LINK_SEGMENTS * 6;
		expect(verts).toBe(state.links.length * perLink);
		const byId = new Map(state.blocks.map((b) => [b.id, b]));
		state.links.forEach((l, k) => {
			const a = byId.get(l.a)!;
			const b = byId.get(l.b)!;
			const mid = (v: number) => {
				const o = (k * perLink + v) * RIBBON_FLOATS;
				return [out[o] * W, out[o + 1] * H];
			};
			// The first quad's two left/right vertices straddle the start.
			const [s0x, s0y] = mid(0);
			const [s1x, s1y] = mid(1);
			expect((s0x + s1x) / 2).toBeCloseTo(
				(a.dx0 + (a.dx1 - a.dx0) * l.au) * W,
				2,
			);
			expect((s0y + s1y) / 2).toBeCloseTo(
				(a.dy0 + (a.dy1 - a.dy0) * l.av) * H,
				2,
			);
			const [e0x, e0y] = mid(perLink - 4);
			const [e1x, e1y] = mid(perLink - 1);
			expect((e0x + e1x) / 2).toBeCloseTo(
				(b.dx0 + (b.dx1 - b.dx0) * l.bu) * W,
				2,
			);
			expect((e0y + e1y) / 2).toBeCloseTo(
				(b.dy0 + (b.dy1 - b.dy0) * l.bv) * H,
				2,
			);
		});
	});

	test("tapers to the ends and swells in the middle", () => {
		const verts = buildLinkRibbons(linkedState(), W, H, 3, 10, out);
		expect(verts).toBeGreaterThan(0);
		const half = (v: number) => out[v * RIBBON_FLOATS + 3];
		const middle = (LINK_SEGMENTS / 2) * 6;
		expect(half(0)).toBeLessThan(half(middle));
		expect(out[4]).toBeLessThan(out[middle * RIBBON_FLOATS + 4]);
	});

	test("a new curve draws itself in", () => {
		const state = linkedState();
		const l = state.links[0];
		const b = state.blocks.find((x) => x.id === l.b)!;
		const endX = (b.dx0 + (b.dx1 - b.dx0) * l.bu) * W;
		const lastX = () => {
			const o = (LINK_SEGMENTS * 6 - 1) * RIBBON_FLOATS;
			return out[o] * W;
		};
		buildLinkRibbons(state, W, H, 3, 0.1, out);
		const early = Math.abs(lastX() - endX);
		buildLinkRibbons(state, W, H, 3, 1, out);
		expect(Math.abs(lastX() - endX)).toBeLessThan(early);
	});
});
