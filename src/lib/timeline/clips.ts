/** Clip geometry shared by every lane that holds free-floating, non-overlapping
 * spans: the text lanes and the sequence fx lanes. Nothing here knows what a clip carries. */

/** Shortest clip a lane will create or leave behind after a resize. */
export const MIN_CLIP_LENGTH = 0.05;

/** Float dust, in seconds, allowed under MIN_CLIP_LENGTH. 0.05 has no exact binary
 * form, so a span built by subtracting it off a gap's end lands a rounding step short. */
const LENGTH_EPSILON = 1e-9;

/** Whether a span is long enough to keep, rounding aside. */
function isKeepableLength(start: number, end: number): boolean {
	return end - start >= MIN_CLIP_LENGTH - LENGTH_EPSILON;
}

export interface TimelineClip {
	id: string;
	/** Seconds on the mode's master timeline. */
	start: number;
	end: number;
}

export interface ClipLane<C extends TimelineClip> {
	clips: C[];
}

export function sortClips<C extends TimelineClip>(clips: C[]): C[] {
	return [...clips].sort((a, b) => a.start - b.start);
}

/** The clip covering `time`, or null. Clips are half-open: [start, end). */
export function clipAt<C extends TimelineClip>(
	lane: ClipLane<C>,
	time: number,
): C | null {
	for (const clip of lane.clips) {
		if (time >= clip.start && time < clip.end) return clip;
	}
	return null;
}

/** The clips between two ids inclusive, in time order: a shift-click range. */
export function clipRange<C extends TimelineClip>(
	lane: ClipLane<C>,
	fromId: string,
	toId: string,
): string[] {
	const ordered = sortClips(lane.clips);
	const a = ordered.findIndex((c) => c.id === fromId);
	const b = ordered.findIndex((c) => c.id === toId);
	if (b === -1) return [];
	if (a === -1) return [toId];
	const [lo, hi] = a <= b ? [a, b] : [b, a];
	return ordered.slice(lo, hi + 1).map((c) => c.id);
}

/** The empty span around `time`, bounded by its neighbours and [0, duration]. */
export function freeRangeAt<C extends TimelineClip>(
	lane: ClipLane<C>,
	time: number,
	duration: number,
): { start: number; end: number } | null {
	if (clipAt(lane, time)) return null;
	let start = 0;
	let end = duration;
	for (const clip of lane.clips) {
		if (clip.end <= time) start = Math.max(start, clip.end);
		if (clip.start > time) end = Math.min(end, clip.start);
	}
	return end - start >= MIN_CLIP_LENGTH ? { start, end } : null;
}

/** Where a clip placed at `time` lands: it starts under the pointer and runs for
 * `want` seconds, held inside the gap it fell in. Null when the gap is too small. */
export function newClipSpan<C extends TimelineClip>(
	lane: ClipLane<C>,
	time: number,
	duration: number,
	want: number,
): { start: number; end: number } | null {
	const gap = freeRangeAt(lane, time, duration);
	if (!gap) return null;
	const room = gap.end - gap.start;
	const len = Math.min(Math.max(want, MIN_CLIP_LENGTH), room);
	// Pinned against the gap's tail, so the span ends where the neighbour begins.
	if (time + len >= gap.end) {
		return { start: Math.max(gap.start, gap.end - len), end: gap.end };
	}
	const start = Math.max(gap.start, time);
	return { start, end: start + len };
}

/** Slide a clip to `newStart`, keeping its length and stopping at its neighbour. */
export function moveClip<C extends TimelineClip, L extends ClipLane<C>>(
	lane: L,
	clipId: string,
	newStart: number,
	duration: number,
): L {
	const clip = lane.clips.find((c) => c.id === clipId);
	if (!clip) return lane;
	const length = clip.end - clip.start;
	const others = sortClips(lane.clips.filter((c) => c.id !== clipId));
	let lower = 0;
	let upper = duration;
	for (const other of others) {
		if (other.end <= clip.start) lower = Math.max(lower, other.end);
		else if (other.start >= clip.end) upper = Math.min(upper, other.start);
	}
	const start = Math.min(
		Math.max(newStart, lower),
		Math.max(lower, upper - length),
	);
	return replaceClip(lane, { ...clip, start, end: start + length });
}

/** Slide every clip in `clipIds` by `delta`, as one block. The group stops at
 * whichever unselected neighbour any member runs into. */
export function moveClips<C extends TimelineClip, L extends ClipLane<C>>(
	lane: L,
	clipIds: string[],
	delta: number,
	duration: number,
): L {
	const ids = new Set(clipIds);
	const moving = lane.clips.filter((c) => ids.has(c.id));
	if (moving.length === 0) return lane;
	const fixed = lane.clips.filter((c) => !ids.has(c.id));

	// The tightest limit any one member imposes governs the whole group.
	let lower = -Infinity;
	let upper = Infinity;
	for (const clip of moving) {
		lower = Math.max(lower, -clip.start);
		upper = Math.min(upper, duration - clip.end);
		for (const other of fixed) {
			if (other.end <= clip.start)
				lower = Math.max(lower, other.end - clip.start);
			else if (other.start >= clip.end)
				upper = Math.min(upper, other.start - clip.end);
		}
	}
	if (lower > upper) return lane;

	const step = Math.min(Math.max(delta, lower), upper);
	if (step === 0) return lane;
	return {
		...lane,
		clips: sortClips(
			lane.clips.map((c) =>
				ids.has(c.id) ? { ...c, start: c.start + step, end: c.end + step } : c,
			),
		),
	};
}

/** Carry clips from one lane to another, shifted by `delta`: a drag that crossed
 * into a neighbouring row. Lands only when every clip fits clear of the target's clips. */
export function moveClipsToLane<
	L extends ClipLane<TimelineClip> & { id: string },
>(
	lanes: L[],
	fromId: string,
	toId: string,
	clipIds: string[],
	delta: number,
	duration: number,
	adapt?: (clip: L["clips"][number], from: L, to: L) => L["clips"][number],
	/** How far (seconds) the group may slide from `delta` to find room; 0 = exact fit only. */
	tolerance = 0,
): L[] {
	if (fromId === toId) return lanes;
	const from = lanes.find((l) => l.id === fromId);
	const to = lanes.find((l) => l.id === toId);
	if (!from || !to) return lanes;
	const ids = new Set(clipIds);
	const moving = from.clips.filter((c) => ids.has(c.id));
	if (moving.length === 0) return lanes;

	const shift = nearestFitDelta(moving, to, delta, duration, tolerance);
	if (shift === null) return lanes;
	const placed = moving.map((c) => ({
		...c,
		start: c.start + shift,
		end: c.end + shift,
	}));

	const landed = adapt ? placed.map((c) => adapt(c, from, to)) : placed;
	return lanes.map((l) => {
		if (l.id === fromId) {
			return { ...l, clips: l.clips.filter((c) => !ids.has(c.id)) };
		}
		if (l.id === toId)
			return { ...l, clips: sortClips([...l.clips, ...landed]) };
		return l;
	});
}

/** Room for the whole group, shifted by `delta`, with nothing else on the lane. */
function groupFits(
	group: readonly TimelineClip[],
	lane: ClipLane<TimelineClip>,
	delta: number,
	duration: number,
): boolean {
	return group.every((c) =>
		fits(lane, c.start + delta, c.end + delta, duration),
	);
}

/** The shift closest to `wanted` at which `group` lands clear on `lane`, or null
 * when nothing within `tolerance` does. */
function nearestFitDelta(
	group: readonly TimelineClip[],
	lane: ClipLane<TimelineClip>,
	wanted: number,
	duration: number,
	tolerance: number,
): number | null {
	if (groupFits(group, lane, wanted, duration)) return wanted;
	if (tolerance <= 0) return null;
	const minStart = Math.min(...group.map((c) => c.start));
	const maxEnd = Math.max(...group.map((c) => c.end));
	const candidates = new Set<number>([-minStart, duration - maxEnd]);
	for (const m of group) {
		for (const o of lane.clips) {
			candidates.add(o.end - m.start);
			candidates.add(o.start - m.end);
		}
	}
	let best: number | null = null;
	for (const d of candidates) {
		if (Math.abs(d - wanted) > tolerance) continue;
		if (best !== null && Math.abs(d - wanted) >= Math.abs(best - wanted))
			continue;
		if (groupFits(group, lane, d, duration)) best = d;
	}
	return best;
}

/** Cut clips that straddle `end` back to it; clips wholly past it are left alone.
 * Kept by identity when nothing straddles. */
export function trimClipsAt<C extends TimelineClip, L extends ClipLane<C>>(
	lane: L,
	end: number,
): L {
	if (!lane.clips.some((c) => c.start < end && c.end > end)) return lane;
	return {
		...lane,
		clips: lane.clips.map((c) =>
			c.start < end && c.end > end
				? { ...c, end: Math.max(end, c.start + MIN_CLIP_LENGTH) }
				: c,
		),
	};
}

/** Drag one edge, keeping at least MIN_CLIP_LENGTH and stopping at the neighbours. */
export function resizeClip<C extends TimelineClip, L extends ClipLane<C>>(
	lane: L,
	clipId: string,
	edge: "start" | "end",
	time: number,
	duration: number,
): L {
	const clip = lane.clips.find((c) => c.id === clipId);
	if (!clip) return lane;
	const others = sortClips(lane.clips.filter((c) => c.id !== clipId));
	if (edge === "start") {
		let lower = 0;
		for (const other of others) {
			if (other.end <= clip.start) lower = Math.max(lower, other.end);
		}
		const start = Math.min(Math.max(time, lower), clip.end - MIN_CLIP_LENGTH);
		return replaceClip(lane, { ...clip, start });
	}
	let upper = duration;
	for (const other of others) {
		if (other.start >= clip.end) upper = Math.min(upper, other.start);
	}
	const end = Math.max(Math.min(time, upper), clip.start + MIN_CLIP_LENGTH);
	return replaceClip(lane, { ...clip, end });
}

/** Drag the edge shared by two flush clips: both facing edges move to `time`. */
export function resizeBoundary<C extends TimelineClip, L extends ClipLane<C>>(
	lane: L,
	leftId: string,
	rightId: string,
	time: number,
): L {
	const left = lane.clips.find((c) => c.id === leftId);
	const right = lane.clips.find((c) => c.id === rightId);
	if (!left || !right) return lane;
	const t = Math.max(
		left.start + MIN_CLIP_LENGTH,
		Math.min(time, right.end - MIN_CLIP_LENGTH),
	);
	return {
		...lane,
		clips: sortClips(
			lane.clips.map((c) =>
				c.id === left.id
					? { ...left, end: t }
					: c.id === right.id
						? { ...right, start: t }
						: c,
			),
		),
	};
}

/** Add a clip, trimmed to the free span it lands in. Unchanged when there is no room. */
export function addClip<C extends TimelineClip, L extends ClipLane<C>>(
	lane: L,
	clip: C,
	duration: number,
): L {
	const range = freeRangeAt(lane, clip.start, duration);
	if (!range) return lane;
	const start = Math.max(clip.start, range.start);
	const end = Math.min(clip.end, range.end);
	if (!isKeepableLength(start, end)) return lane;
	return {
		...lane,
		clips: sortClips([...lane.clips, { ...clip, start, end }]),
	};
}

export function removeClip<C extends TimelineClip, L extends ClipLane<C>>(
	lane: L,
	clipId: string,
): L {
	return { ...lane, clips: lane.clips.filter((c) => c.id !== clipId) };
}

function replaceClip<C extends TimelineClip, L extends ClipLane<C>>(
	lane: L,
	clip: C,
): L {
	return {
		...lane,
		clips: sortClips(lane.clips.map((c) => (c.id === clip.id ? clip : c))),
	};
}

/** A copied clip's place: which lane, and where relative to the block's anchor. */
export interface ClipBlockEntry {
	laneId: string;
	/** Seconds from the block's anchor. */
	offset: number;
	length: number;
}

/** Sub-frame slop, so a clip butted against its neighbour still counts as free. */
const FIT_EPSILON = 1e-6;

/** Room for [start, end) on this lane, with nothing already there. */
function fits(
	lane: ClipLane<TimelineClip>,
	start: number,
	end: number,
	duration: number,
): boolean {
	if (start < -FIT_EPSILON || end > duration + FIT_EPSILON) return false;
	for (const c of lane.clips) {
		if (start < c.end - FIT_EPSILON && end > c.start + FIT_EPSILON)
			return false;
	}
	return true;
}

/** How far a block of copied clips has to slide right from `at` to land clear of
 * everything on its lanes, or null when it never does. */
function firstFreeDelta(
	entries: ClipBlockEntry[],
	lanes: ReadonlyMap<string, ClipLane<TimelineClip>>,
	at: number,
	duration: number,
): number | null {
	const live = entries.filter((e) => lanes.has(e.laneId));
	if (live.length === 0) return null;
	const candidates = new Set<number>([0]);
	for (const e of live) {
		for (const c of lanes.get(e.laneId)!.clips) {
			const delta = c.end - (at + e.offset);
			if (delta > 0) candidates.add(delta);
		}
	}
	for (const delta of [...candidates].sort((a, b) => a - b)) {
		const clear = live.every((e) => {
			const start = at + e.offset + delta;
			return fits(lanes.get(e.laneId)!, start, start + e.length, duration);
		});
		if (clear) return delta;
	}
	return null;
}

/** Move a copied block onto other lanes: its first lane becomes `targetLaneId`. */
export function retargetClipBlock<E extends ClipBlockEntry>(
	entries: E[],
	laneIds: string[],
	targetLaneId: string | null | undefined,
): E[] {
	if (!targetLaneId) return entries;
	const to = laneIds.indexOf(targetLaneId);
	if (to === -1) return entries;
	let from = Infinity;
	for (const e of entries) {
		const i = laneIds.indexOf(e.laneId);
		if (i !== -1) from = Math.min(from, i);
	}
	if (from === Infinity || from === to) return entries;
	const out: E[] = [];
	for (const e of entries) {
		const i = laneIds.indexOf(e.laneId);
		if (i === -1) continue;
		const j = i - from + to;
		if (j < laneIds.length) out.push({ ...e, laneId: laneIds[j] });
	}
	return out;
}

/** Where one copied entry lands. */
export interface ClipPlacement<E extends ClipBlockEntry> {
	entry: E;
	start: number;
	end: number;
}

/** Where a pasted block of clips goes, with its earliest clip at `at`. At full
 * length if anywhere downstream has room; otherwise each clip is cut to fit. */
export function placeClipBlock<E extends ClipBlockEntry>(
	entries: E[],
	lanes: ReadonlyMap<string, ClipLane<TimelineClip>>,
	at: number,
	duration: number,
): ClipPlacement<E>[] {
	at = Math.max(0, at);
	const live = entries.filter((e) => lanes.has(e.laneId));
	const delta = firstFreeDelta(live, lanes, at, duration);
	if (delta !== null) {
		return live.map((entry) => ({
			entry,
			start: at + entry.offset + delta,
			end: at + entry.offset + delta + entry.length,
		}));
	}

	// Earlier entries take their room before later ones look for theirs.
	const taken = new Map<string, TimelineClip[]>();
	for (const [id, lane] of lanes) taken.set(id, [...lane.clips]);
	const out: ClipPlacement<E>[] = [];
	for (const entry of live) {
		const clips = taken.get(entry.laneId)!;
		const lane = { clips };
		let start = at + entry.offset;
		for (let c = clipAt(lane, start); c; c = clipAt(lane, start)) {
			start = c.end;
		}
		const range = freeRangeAt(lane, start, duration);
		if (!range) continue;
		const end = Math.min(start + entry.length, range.end);
		if (end - start < MIN_CLIP_LENGTH) continue;
		clips.push({ id: "placed-" + out.length, start, end });
		out.push({ entry, start, end });
	}
	return out;
}

/** Apply a lane edit inside a list of lanes. */
export function updateLaneIn<L extends { id: string }>(
	lanes: L[],
	laneId: string,
	fn: (lane: L) => L,
): L[] {
	return lanes.map((l) => (l.id === laneId ? fn(l) : l));
}

/** Apply one edit to every clip in `clipIds`, across lanes. */
export function updateClipsIn<C extends TimelineClip, L extends ClipLane<C>>(
	lanes: L[],
	clipIds: ReadonlySet<string>,
	fn: (clip: C, lane: L) => C,
): L[] {
	if (!lanes.some((l) => l.clips.some((c) => clipIds.has(c.id)))) return lanes;
	return lanes.map((lane) => {
		if (!lane.clips.some((c) => clipIds.has(c.id))) return lane;
		return {
			...lane,
			clips: lane.clips.map((c) => (clipIds.has(c.id) ? fn(c, lane) : c)),
		};
	});
}

/** The lanes with one clip swapped for its edited self, wherever it is. */
export function replaceClipIn<C extends TimelineClip, L extends ClipLane<C>>(
	lanes: L[],
	next: C,
): L[] {
	return updateClipsIn(lanes, new Set([next.id]), () => next);
}

/** How strongly a clip applies at `time`: 1 across the body, ramping from 0 at
 * each edge that has a fade. */
export function clipFadeWeight(
	clip: TimelineClip,
	fadeInSec: number | undefined,
	fadeOutSec: number | undefined,
	time: number,
): number {
	let fadeIn = Math.max(0, fadeInSec ?? 0);
	let fadeOut = Math.max(0, fadeOutSec ?? 0);
	if (fadeIn <= 0 && fadeOut <= 0) return 1;
	const length = clip.end - clip.start;
	if (length <= 0) return 1;
	// Ramps that outlast the clip would never reach full strength; shrink both to meet.
	if (fadeIn + fadeOut > length) {
		const scale = length / (fadeIn + fadeOut);
		fadeIn *= scale;
		fadeOut *= scale;
	}
	if (time < clip.start || time > clip.end) return 0;
	const inWeight = fadeIn > 0 ? (time - clip.start) / fadeIn : 1;
	const outWeight = fadeOut > 0 ? (clip.end - time) / fadeOut : 1;
	return Math.max(0, Math.min(1, inWeight, outWeight));
}

/** Clamp a lane's clips into [0, duration], for when the master clock shrinks under
 * them. Clips keep their start and lose only the overhang. */
export function fitClipsToDuration<
	C extends TimelineClip,
	L extends ClipLane<C>,
>(lane: L, duration: number): L {
	if (duration <= 0) return lane;
	let changed = false;
	const clips: C[] = [];
	for (const clip of lane.clips) {
		if (clip.start > duration - MIN_CLIP_LENGTH) {
			changed = true;
			continue;
		}
		if (clip.end > duration) {
			clips.push({ ...clip, end: duration });
			changed = true;
		} else {
			clips.push(clip);
		}
	}
	return changed ? { ...lane, clips } : lane;
}
