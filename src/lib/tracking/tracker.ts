import type {
	BoxState,
	FrameBox,
	SalPoint,
	TrackBox,
	TrackingFrame,
	TrackingParams,
	TrackingState,
} from "./types";
import { contentBounds, MARGIN, type Bounds } from "./saliency";

const HEX = "0123456789ABCDEF";

/** Deterministic 0..1 hash of two integers. */
function hash2(a: number, b: number): number {
	let h = Math.imul((a | 0) ^ 0x9e3779b9, 0x85ebca6b);
	h = Math.imul(h ^ ((b | 0) + 0x165667b1), 0xc2b2ae35);
	h ^= h >>> 13;
	return (h >>> 0) / 4294967296;
}

function hexId(seed: number, key: number): string {
	let s = "";
	for (let i = 0; i < 4; i++) {
		s += HEX[Math.floor(hash2(seed + key * 17, i) * 16)];
	}
	return s;
}

export function readTrackingParams(
	v: Record<string, number | string>,
): TrackingParams {
	const num = (key: string, d: number) =>
		typeof v[key] === "number" ? (v[key] as number) : d;
	const str = (key: string, d: string) =>
		typeof v[key] === "string" ? (v[key] as string) : d;
	return {
		count: Math.max(1, Math.round(num("count", 5))),
		sensitivity: num("sensitivity", 0.5),
		size: num("size", 0.12),
		thickness: num("thickness", 2),
		opacity: num("opacity", 1),
		color: str("color", "white") as TrackingParams["color"],
	};
}

/** Fixed seed for hex identities and per-box size variation. */
const SEED = 42;

function placementSignature(p: TrackingParams): string {
	return `${p.count}|${p.sensitivity.toFixed(3)}|${p.size.toFixed(3)}`;
}

/** Rebuild the persistent box set from the current salient points when the
 * placement params changed or the set is empty; boxes otherwise persist, their
 * motion owned by trackBoxes. */
export function syncBoxes(
	state: TrackingState,
	params: TrackingParams,
	time: number,
): void {
	const sig = placementSignature(params);
	const needsRebuild = state.signature !== sig || state.boxes.length === 0;
	if (!needsRebuild) return;

	const pts = state.salPoints;
	const boxes: TrackBox[] = [];
	for (let k = 0; k < pts.length && k < params.count; k++) {
		const pt = pts[k];
		const sizeVar = 0.6 + hash2(SEED + k, 3) * 0.9;
		const aspect = 0.7 + hash2(SEED + k, 5) * 0.6;
		const w = params.size * sizeVar;
		const h = w * aspect;
		const prev = state.boxes[k];
		boxes.push({
			key: k,
			hex: hexId(SEED, k),
			baseX: pt.x,
			baseY: pt.y,
			drawX: pt.x,
			drawY: pt.y,
			w,
			h,
			quality: 0.6,
			state: "lock",
			stateChangedAt: time,
			// Fresh boxes spawn already faded in so a single frozen render (PNG/JPG preview)
			// shows the HUD; the fade only plays on later re-acquires.
			acquiredAt: prev ? prev.acquiredAt : time - 0.35,
			template: null,
			vx: 0,
			vy: 0,
		});
	}
	state.boxes = boxes;
	state.signature = sig;
	state.primaryKey = -1;
}

const PATCH_R = 4; // 9x9-cell template
const PATCH_N = (PATCH_R * 2 + 1) * (PATCH_R * 2 + 1);
const SEARCH_R = 6; // cells searched around the predicted position
const WIDE_SEARCH_R = 16; // while lost, how far to look for the same target
// A patch whose zero-mean length is under this is flat: nothing to recognize.
const FLAT = 0.08;
// Match scores (normalized cross-correlation, -1..1) mapped onto quality 0..1.
const MATCH_FLOOR = 0.4;
const MATCH_FULL = 0.9;
const FOUND = 0.75; // a lost box takes a match this good as its target again
const REFRESH = 0.8; // matches this good update the template
const ANCHOR = 0.7; // the template still recognizes the target this well
const MAX_SPEED = 2; // normalized units per second
const DUPLICATE = 0.04; // two boxes this close are following the same thing

// Quality thresholds for the state machine (with hysteresis).
const Q_DEGRADE = 0.5; // lock → degraded below this
const Q_RELOCK = 0.65; // degraded → lock above this
const Q_LOST = 0.22; // degraded → lost below this
// Disturbance below this counts as "the feed has settled".
const SETTLED = 0.25;
const LOST_MIN_S = 0.35; // minimum time spent visibly lost
const GIVE_UP_S = 1; // settled this long without finding it: pick a new target
const LOST_MAX_S = 2.5; // force reacquire even mid-disturbance
const REACQUIRE_S = 0.45; // search animation length

/** Frame-to-frame tracking with believable failure. Each box keeps a template of
 * its target and looks for it where its velocity says it went, matching by
 * normalized cross-correlation so a brightness shift isn't a lost target. The
 * match score drives a signal quality that drops fast and recovers slowly. A lost
 * box first looks for its old target, then settles for a new one nearby. */
export function trackBoxes(
	state: TrackingState,
	lum: Float32Array,
	gw: number,
	gh: number,
	time: number,
): void {
	const gap = state.lastTick < 0 ? Infinity : time - state.lastTick;
	state.lastTick = time;
	const prev = state.prevLum;

	if (gap < 0 || gap > 0.4) {
		// Scene cut or single-frame render (frozen preview, param tweak between stills,
		// time reset): no frame-to-frame story to tell. Re-seat boxes instantly onto the
		// current content, confident and locked, so a still export shows a clean HUD.
		state.disturbance = 0;
		for (let k = 0; k < state.boxes.length; k++) {
			const box = state.boxes[k];
			const pt = state.salPoints[k];
			if (pt) {
				box.baseX = pt.x;
				box.baseY = pt.y;
			}
			box.drawX = box.baseX;
			box.drawY = box.baseY;
			box.quality = 0.75;
			forgetTarget(box);
			if (box.state !== "lock") setState(box, "lock", time);
		}
	} else if (prev && state.gridW === gw && state.gridH === gh) {
		// Global disturbance: rises instantly with frame change, decays ~0.5s.
		let diff = 0;
		const n = gw * gh;
		for (let i = 0; i < n; i++) diff += Math.abs(lum[i] - prev[i]);
		const inst = Math.min(1, (diff / n) * 8);
		state.disturbance = Math.max(inst, state.disturbance * 0.75);
		const bounds = contentBounds(lum, gw, gh);

		for (const box of state.boxes) {
			switch (box.state) {
				case "lock":
				case "degraded":
					followBox(box, prev, lum, gw, gh, gap, bounds);
					if (box.state === "lock" && box.quality < Q_DEGRADE) {
						setState(box, "degraded", time);
					} else if (box.state === "degraded") {
						if (box.quality < Q_LOST) setState(box, "lost", time);
						else if (box.quality > Q_RELOCK) setState(box, "lock", time);
					}
					break;
				case "lost": {
					// Frozen where it lost the target until it turns up again or the feed settles.
					const lostFor = time - box.stateChangedAt;
					if (lostFor < LOST_MIN_S) break;
					if (refind(box, lum, gw, gh, time, bounds)) break;
					const settled = state.disturbance < SETTLED && lostFor > GIVE_UP_S;
					if (settled || lostFor > LOST_MAX_S) {
						reacquire(box, state, time);
					}
					break;
				}
				case "reacquire":
					followBox(box, prev, lum, gw, gh, gap, bounds);
					if (time - box.stateChangedAt > REACQUIRE_S) {
						box.quality = Math.max(box.quality, 0.6);
						setState(box, "lock", time);
					}
					break;
			}
		}
		dropDuplicates(state, time);

		// Primary designation (drone hierarchy): sticky, reassigned only when the current
		// primary is gone or has lost its target.
		const cur = state.boxes.find((b) => b.key === state.primaryKey);
		if (!cur || cur.state === "lost" || cur.quality < 0.3) {
			let best: TrackBox | null = null;
			for (const b of state.boxes) {
				if (b.state === "lost" || b.state === "reacquire") continue;
				if (!best || b.quality > best.quality) best = b;
			}
			if (best) state.primaryKey = best.key;
			else if (!cur) state.primaryKey = -1;
		}
	}
	// Store the new grid for the next tick (copy: the RGBA buffer is reused).
	state.prevLum = lum.slice();
	state.gridW = gw;
	state.gridH = gh;
}

/** Find the box's target near where its velocity predicts; move it and its
 * quality to match. Matched against how the target looked last tick, which holds
 * through slow changes in its look; the kept template is for finding it again. */
function followBox(
	box: TrackBox,
	prev: Float32Array,
	lum: Float32Array,
	gw: number,
	gh: number,
	dt: number,
	bounds: Bounds,
): void {
	const sx = gw - 1;
	const sy = gh - 1;
	const x = box.baseX * sx;
	const y = box.baseY * sy;
	const recent = readPatch(prev, gw, gh, x, y);
	box.template ??= recent && recent.slice();
	const tpl = recent ?? box.template;
	const px = x + box.vx * dt * sx;
	const py = y + box.vy * dt * sy;
	const m = tpl ? search(tpl, lum, gw, gh, px, py, SEARCH_R) : null;
	// A target leaving the picture is lost, not pinned against its edge.
	const score = m && inside(m, bounds) ? m.score : 0;
	const q = qualityOf(score);
	// Asymmetric smoothing: lose the lock fast, re-confirm it slowly.
	box.quality =
		q < box.quality
			? box.quality * 0.4 + q * 0.6
			: box.quality * 0.85 + q * 0.15;
	if (!m || score < MATCH_FLOOR) {
		// Nothing there worth following: hold still rather than chase noise.
		box.vx *= 0.5;
		box.vy *= 0.5;
		return;
	}
	// Frame-to-frame errors add up, so the kept template pulls the box back onto the
	// spot it locked whenever it still recognizes it there.
	const anchored = box.template
		? search(box.template, lum, gw, gh, m.x, m.y, 1)
		: null;
	const at = anchored && anchored.score > ANCHOR ? anchored : m;
	// Only the velocity is smoothed: the next patch is read where the target is, or
	// any lag would become an offset the box keeps forever. The drawn box eases.
	if (dt > 0) {
		box.vx = clampSpeed(box.vx + ((at.x - px) * 0.5) / dt / sx);
		box.vy = clampSpeed(box.vy + ((at.y - py) * 0.5) / dt / sy);
	}
	box.baseX = clamp01(at.x / sx);
	box.baseY = clamp01(at.y / sy);
	if (score > REFRESH && box.template) {
		refreshTemplate(box.template, lum, gw, gh, at.x, at.y);
	}
}

function inside(m: Match, b: Bounds): boolean {
	return (
		m.x >= b.x0 + MARGIN &&
		m.x <= b.x1 - MARGIN &&
		m.y >= b.y0 + MARGIN &&
		m.y <= b.y1 - MARGIN
	);
}

/** Look wider for a lost box's own target; true when it turned up. */
function refind(
	box: TrackBox,
	lum: Float32Array,
	gw: number,
	gh: number,
	time: number,
	bounds: Bounds,
): boolean {
	if (!box.template) return false;
	const sx = gw - 1;
	const sy = gh - 1;
	const m = search(
		box.template,
		lum,
		gw,
		gh,
		box.baseX * sx,
		box.baseY * sy,
		WIDE_SEARCH_R,
	);
	if (m.score < FOUND || !inside(m, bounds)) return false;
	box.baseX = clamp01(m.x / sx);
	box.baseY = clamp01(m.y / sy);
	box.quality = qualityOf(m.score);
	box.vx = 0;
	box.vy = 0;
	box.acquiredAt = time;
	setState(box, "reacquire", time);
	return true;
}

/** Two boxes that ended up on the same thing: the weaker one lets go. */
function dropDuplicates(state: TrackingState, time: number): void {
	const boxes = state.boxes;
	for (let i = 0; i < boxes.length; i++) {
		for (let j = i + 1; j < boxes.length; j++) {
			const a = boxes[i];
			const b = boxes[j];
			if (!isTracking(a) || !isTracking(b)) continue;
			const dx = a.baseX - b.baseX;
			const dy = a.baseY - b.baseY;
			if (dx * dx + dy * dy > DUPLICATE * DUPLICATE) continue;
			const weaker = a.quality < b.quality ? a : b;
			forgetTarget(weaker);
			setState(weaker, "lost", time);
		}
	}
}

function isTracking(box: TrackBox): boolean {
	return box.state === "lock" || box.state === "degraded";
}

interface Match {
	x: number;
	y: number;
	score: number;
}

/** Best template match within `r` cells of (x, y), refined to a fraction of a
 * cell so slow motion isn't rounded away. */
function search(
	tpl: Float32Array,
	lum: Float32Array,
	gw: number,
	gh: number,
	x: number,
	y: number,
	r: number,
): Match {
	const x0 = Math.round(x);
	const y0 = Math.round(y);
	const size = r * 2 + 1;
	const scores = new Float32Array(size * size).fill(-Infinity);
	let best = -Infinity;
	let bestRank = -Infinity;
	let bx = x0;
	let by = y0;
	for (let dy = -r; dy <= r; dy++) {
		const cy = y0 + dy;
		if (cy < 0 || cy >= gh) continue;
		for (let dx = -r; dx <= r; dx++) {
			const cx = x0 + dx;
			if (cx < 0 || cx >= gw) continue;
			const s = matchAt(tpl, lum, gw, gh, cx, cy);
			scores[(dy + r) * size + dx + r] = s;
			// Near-ties go to the prediction, so repeated texture doesn't pull the box off.
			const rank = s - (dx * dx + dy * dy) * 0.0005;
			if (rank > bestRank) {
				bestRank = rank;
				best = s;
				bx = cx;
				by = cy;
			}
		}
	}
	const at = (cx: number, cy: number) => {
		const ix = cx - x0 + r;
		const iy = cy - y0 + r;
		if (ix < 0 || iy < 0 || ix >= size || iy >= size) return -Infinity;
		return scores[iy * size + ix];
	};
	return {
		x: bx + peakOffset(at(bx - 1, by), best, at(bx + 1, by)),
		y: by + peakOffset(at(bx, by - 1), best, at(bx, by + 1)),
		score: best,
	};
}

/** Where a parabola through three neighbouring scores peaks, -0.5..0.5. */
function peakOffset(l: number, c: number, r: number): number {
	if (!Number.isFinite(l) || !Number.isFinite(r)) return 0;
	const curve = l - 2 * c + r;
	if (curve >= 0) return 0;
	return Math.max(-0.5, Math.min(0.5, (l - r) / (2 * curve)));
}

/** Normalized cross-correlation of the template with the patch centred on a cell. */
function matchAt(
	tpl: Float32Array,
	lum: Float32Array,
	gw: number,
	gh: number,
	cx: number,
	cy: number,
): number {
	let dot = 0;
	let sum = 0;
	let sq = 0;
	let i = 0;
	for (let oy = -PATCH_R; oy <= PATCH_R; oy++) {
		const row = clampInt(cy + oy, gh) * gw;
		for (let ox = -PATCH_R; ox <= PATCH_R; ox++) {
			const v = lum[row + clampInt(cx + ox, gw)];
			dot += tpl[i++] * v;
			sum += v;
			sq += v * v;
		}
	}
	const spread = Math.sqrt(Math.max(0, sq - (sum * sum) / PATCH_N));
	// The template sums to zero, so the patch's mean drops out of the dot product.
	return spread < FLAT ? 0 : dot / spread;
}

/** The patch around a fractional cell, zero-mean and unit length; null when flat. */
function readPatch(
	lum: Float32Array,
	gw: number,
	gh: number,
	x: number,
	y: number,
): Float32Array | null {
	const patch = new Float32Array(PATCH_N);
	let i = 0;
	for (let oy = -PATCH_R; oy <= PATCH_R; oy++) {
		for (let ox = -PATCH_R; ox <= PATCH_R; ox++) {
			patch[i++] = sample(lum, gw, gh, x + ox, y + oy);
		}
	}
	return normalizePatch(patch) ? patch : null;
}

/** Blend the target's current look into its template, so it follows slow changes
 * in appearance without drifting onto whatever passes in front. */
function refreshTemplate(
	tpl: Float32Array,
	lum: Float32Array,
	gw: number,
	gh: number,
	x: number,
	y: number,
): void {
	const cur = readPatch(lum, gw, gh, x, y);
	if (!cur) return;
	const keep = tpl.slice();
	for (let i = 0; i < PATCH_N; i++) tpl[i] = tpl[i] * 0.9 + cur[i] * 0.1;
	if (!normalizePatch(tpl)) tpl.set(keep);
}

/** Zero-mean, unit length in place; false when the patch is too flat for that. */
function normalizePatch(p: Float32Array): boolean {
	let mean = 0;
	for (let i = 0; i < p.length; i++) mean += p[i];
	mean /= p.length;
	let len = 0;
	for (let i = 0; i < p.length; i++) {
		p[i] -= mean;
		len += p[i] * p[i];
	}
	len = Math.sqrt(len);
	if (len < FLAT) return false;
	for (let i = 0; i < p.length; i++) p[i] /= len;
	return true;
}

/** Bilinear luminance at a fractional cell, clamped to the grid. */
function sample(
	lum: Float32Array,
	gw: number,
	gh: number,
	x: number,
	y: number,
): number {
	const cx = Math.max(0, Math.min(gw - 1, x));
	const cy = Math.max(0, Math.min(gh - 1, y));
	const x0 = Math.floor(cx);
	const y0 = Math.floor(cy);
	const x1 = Math.min(gw - 1, x0 + 1);
	const y1 = Math.min(gh - 1, y0 + 1);
	const fx = cx - x0;
	const fy = cy - y0;
	const top = lum[y0 * gw + x0] * (1 - fx) + lum[y0 * gw + x1] * fx;
	const bottom = lum[y1 * gw + x0] * (1 - fx) + lum[y1 * gw + x1] * fx;
	return top * (1 - fy) + bottom * fy;
}

function qualityOf(score: number): number {
	return clamp01((score - MATCH_FLOOR) / (MATCH_FULL - MATCH_FLOOR));
}

function forgetTarget(box: TrackBox): void {
	box.template = null;
	box.vx = 0;
	box.vy = 0;
}

function setState(box: TrackBox, next: BoxState, time: number): void {
	box.state = next;
	box.stateChangedAt = time;
}

function clamp01(v: number): number {
	return Math.max(0, Math.min(1, v));
}

function clampInt(c: number, size: number): number {
	return c < 0 ? 0 : c >= size ? size - 1 : c;
}

function clampSpeed(v: number): number {
	return Math.max(-MAX_SPEED, Math.min(MAX_SPEED, v));
}

/** Put a lost box on a salient point no other box claims, favouring strong points
 * near where it lost its target over the strongest one anywhere. */
function reacquire(box: TrackBox, state: TrackingState, time: number): void {
	const top = state.salPoints[0]?.score ?? 0;
	let best: SalPoint | null = null;
	let bestRank = -Infinity;
	for (const pt of state.salPoints) {
		let claimed = false;
		for (const other of state.boxes) {
			if (other === box) continue;
			const dx = other.baseX - pt.x;
			const dy = other.baseY - pt.y;
			if (dx * dx + dy * dy < 0.01) {
				claimed = true;
				break;
			}
		}
		if (claimed) continue;
		const dx = box.baseX - pt.x;
		const dy = box.baseY - pt.y;
		const rank = pt.score / top - (dx * dx + dy * dy) * 2;
		if (rank > bestRank) {
			bestRank = rank;
			best = pt;
		}
	}
	if (!best) return; // nothing to lock onto yet, retry next tick
	box.baseX = best.x;
	box.baseY = best.y;
	box.quality = 0.4;
	box.acquiredAt = time;
	forgetTarget(box);
	setState(box, "reacquire", time);
}

function pad(n: number, width: number): string {
	const s = Math.abs(Math.round(n)).toString();
	return s.padStart(width, "0");
}

const STATUS: Record<BoxState, string> = {
	lock: "LOCK",
	degraded: "TRACK",
	lost: "SIGNAL LOST",
	reacquire: "ACQ",
};

/** Resolve every persistent box into a drawable frame (motion + labels). */
export function resolveFrame(
	state: TrackingState,
	time: number,
	imgW: number,
	imgH: number,
): TrackingFrame {
	const boxes: FrameBox[] = [];
	const margin = 0.02;

	for (const box of state.boxes) {
		// Display easing per state: smooth when locked, hesitant when degraded, frozen
		// when lost, snappy while reacquiring.
		let ease: number;
		if (box.state === "lock") ease = 0.25;
		else if (box.state === "degraded") ease = 0.09;
		else if (box.state === "reacquire") ease = 0.5;
		else ease = 0;
		box.drawX += (box.baseX - box.drawX) * ease;
		box.drawY += (box.baseY - box.drawY) * ease;

		const cx = Math.min(1 - margin, Math.max(margin, box.drawX));
		const cy = Math.min(1 - margin, Math.max(margin, box.drawY));

		const primary = box.key === state.primaryKey;
		let label = "";
		let sub = "";
		if (primary) {
			label = `TGT ${box.hex} ${STATUS[box.state]}`;
			sub = `X:${pad(cx * imgW, 4)} Y:${pad(cy * imgH, 4)}`;
		} else if (box.state === "lost") {
			label = STATUS[box.state];
		} else {
			label = box.hex;
		}

		// Brackets fade in on acquire.
		const age = time - box.acquiredAt;
		const alpha = Math.min(1, Math.max(0, age / 0.35));

		boxes.push({
			cx,
			cy,
			w: box.w,
			h: box.h,
			hex: box.hex,
			state: box.state,
			stateAge: time - box.stateChangedAt,
			primary,
			label,
			sub,
			alpha,
		});
	}

	return { boxes, disturbance: state.disturbance };
}
