import { keyTester, type ChromaKey } from "./source-edit";

/** A connected point seeds from the matching pixels this close to it, as a share
 * of the frame's long edge: footage drifts, and the exact pixel may not match next frame. */
export const KEY_SEED_RADIUS = 0.006;

/** Coverage below this counts as matching a point, soft band included. */
export const KEY_REACH_MATCH = 0.999;

/**
 * The area the key's connected points cut, over an rgba frame: every pixel that
 * matches a connected point and touches one through matching 4-neighbours.
 * 1 = reached. Matches of every connected point pool into one area.
 */
export function keyReach(
	px: Uint8ClampedArray,
	w: number,
	h: number,
	key: Omit<ChromaKey, "enabled">,
): Uint8Array {
	const reach = new Uint8Array(w * h);
	const seeds = key.points.filter((p) => p.connected);
	if (seeds.length === 0 || w <= 0 || h <= 0) return reach;
	const test = keyTester(key, (p) => p.connected);
	// 0 = untested, 1 = matches, 2 = doesn't.
	const match = new Uint8Array(w * h);
	const matches = (i: number) => {
		if (match[i] === 0) {
			const o = i * 4;
			match[i] =
				test(px[o] / 255, px[o + 1] / 255, px[o + 2] / 255) < KEY_REACH_MATCH
					? 1
					: 2;
		}
		return match[i] === 1;
	};
	// Each pixel is pushed once at most: it is marked reached before it goes on.
	const stack = new Int32Array(w * h);
	let top = 0;
	const visit = (i: number) => {
		if (reach[i] || !matches(i)) return;
		reach[i] = 1;
		stack[top++] = i;
	};
	const r = Math.max(1, Math.round(Math.max(w, h) * KEY_SEED_RADIUS));
	for (const p of seeds) {
		const cx = Math.min(w - 1, Math.floor(p.x * w));
		const cy = Math.min(h - 1, Math.floor(p.y * h));
		for (let y = Math.max(0, cy - r); y <= Math.min(h - 1, cy + r); y++) {
			for (let x = Math.max(0, cx - r); x <= Math.min(w - 1, cx + r); x++) {
				visit(y * w + x);
			}
		}
	}
	while (top > 0) {
		const i = stack[--top];
		const x = i % w;
		if (x > 0) visit(i - 1);
		if (x < w - 1) visit(i + 1);
		if (i >= w) visit(i - w);
		if (i < w * (h - 1)) visit(i + w);
	}
	return reach;
}
