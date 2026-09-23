/** What every clip lane component does the same way: selection, dragging clips and
 * boundaries, scrubbing, adding and splitting, deleting, and the keyboard. */

import { untrack } from "svelte";
import type { TimelineStackState } from "../editor/timeline-stack.svelte";
import { isTextEntryTarget } from "../editor/shortcut-target";
import { isModalKeyboardOpen } from "../modal-keyboard";
import { latestCopy, markCopied } from "../editor/copy-stamp";
import { dropAutoRangeScope } from "../audio/auto-range";
import { dragClipsStep, laneSnapPoints, type ClipDrag } from "./clip-drag";
import { sourceEndOwner, type SnapPoint } from "./snap";
import {
	addClip,
	clipRange,
	freeRangeAt,
	MIN_CLIP_LENGTH,
	moveClipsToLane,
	removeClip,
	sortClips,
	updateLaneIn,
	type ClipLane,
	type TimelineClip,
} from "./clips";
import {
	adjacentPairs,
	boundaryWidth,
	clipPx,
	edgeWidth,
	type AdjacentPair,
} from "./lane-geometry";
import {
	copyJoins,
	joinDeltaLimits,
	joinPastePoints,
	joinRefs,
	moveJoins,
	pasteJoins,
	type CopiedJoin,
	type JoinRef,
} from "./join-group";

export type ClipEdgeMode = "move" | "start" | "end";

export interface ClipLaneHost<
	C extends TimelineClip,
	L extends ClipLane<C> & { id: string; name: string },
> {
	/** Coalesce-key prefix, so one lane kind's drag never merges with another's. */
	kind: string;
	/** Length a click-to-add clip gets, when the gap it lands in allows it. */
	defaultClipLength: number;
	readonly lanes: L[];
	setLanes(lanes: L[]): void;
	onBeforeEdit?(coalesceKey?: string): void;
	/** The primary selection, and the whole selection it is always a member of. */
	selectedClipId: string | null;
	selectedClipIds: string[];
	createClip(start: number, end: number): C;
	splitClipAt(lane: L, at: number): L;
	/** The span a clip added at `time` gets; the default fills the gap up to
	 * `defaultClipLength`. */
	clipSpanAt?(lane: L, time: number): { start: number; end: number } | null;
	/** What a clip keeps when a drag carries it onto another lane. */
	remapOnLaneChange?(clip: C, from: L, to: L): C;
	/** Fired when a click narrows the selection to one clip. */
	onSelectOnly?(): void;
	/** Ctrl+C / Ctrl+V; true when handled. */
	copy(): boolean;
	paste(): boolean;
	/** Joins carry something to edit (a transition): clicking one calls this with the
	 * joins it edits, named by the clip to their right, and a box selects them too. */
	onJoinClick?(rightIds: string[], anchor: DOMRect): void;
	/** Timeline times where a clip's media runs out, measured as if it ran to `until`;
	 * a dragged edge snaps to them. */
	sourceEnds?(clip: C, lane: L, until: number): number[];
	/** What a copied join carries over to where it's pasted. */
	readJoin?(right: C): unknown;
	writeJoin?(right: C, data: unknown): C;
}

/** A shift-drag box over the lanes it spans, in time. */
export interface ClipMarquee {
	laneIds: string[];
	from: number;
	to: number;
}

export class ClipLaneController<
	C extends TimelineClip,
	L extends ClipLane<C> & { id: string; name: string },
> {
	readonly host: ClipLaneHost<C, L>;
	readonly stack: TimelineStackState;

	drag = $state<ClipDrag | null>(null);
	scrubbing = $state(false);
	/** Lane the delete button is asking about; null when nothing is pending. */
	lanePendingDelete = $state<L | null>(null);
	/** The lane geometry, for hit-testing against the track. Every lane shares one. */
	trackEl: HTMLElement | undefined;

	/** Joins picked by a box or shift-click, by the id of the clip to their right. */
	selectedJoins = $state<string[]>([]);
	marquee = $state<ClipMarquee | null>(null);

	/** Set on pointerdown when a plain click landed on an already-selected clip, so the
	 * selection survives until pointerup and the clip can still be dragged. */
	#clickOnUp: string | null = null;
	/** A shift press waiting to see whether it drags a box or clicks. */
	#boxStart: {
		time: number;
		x: number;
		y: number;
		laneId: string;
		clipId: string | null;
	} | null = null;
	/** A join pressed but not yet dragged: releasing it there is a click. */
	#joinPress: { rightId: string; anchor: DOMRect } | null = null;
	/** Undo key a join drag records on its first move, so a click adds no step. */
	#pendingEditKey: string | null = null;
	/** Several selected joins dragged as one, from where they sat at the press. */
	#joinGroup: {
		joins: JoinRef[];
		anchor: number;
		min: number;
		max: number;
	} | null = null;

	/** Copied joins, laid down by clicking once Ctrl+V has armed the paste. */
	joinClipboard = $state<CopiedJoin<unknown>[]>([]);
	#joinStamp = -1;
	pastingJoins = $state(false);
	/** Where the armed paste would land, following the pointer. */
	pasteCursor = $state<{ laneId: string; time: number } | null>(null);

	constructor(host: ClipLaneHost<C, L>, stack: TimelineStackState) {
		this.host = host;
		this.stack = stack;
	}

	get trackDuration(): number {
		return this.stack.trackDuration;
	}

	selectOnly(clipId: string): void {
		this.host.selectedClipId = clipId;
		this.host.selectedClipIds = [clipId];
		this.selectedJoins = [];
		this.host.onSelectOnly?.();
	}

	deselect(): void {
		this.host.selectedClipId = null;
		this.host.selectedClipIds = [];
		this.selectedJoins = [];
	}

	/** The clips that start on a join, across every lane. */
	#joinIds(): Set<string> {
		return new Set(
			this.host.lanes.flatMap((l) => adjacentPairs(l).map((p) => p.right.id)),
		);
	}

	/** Follow external changes to the primary and drop ids whose clips are gone. */
	syncSelection(): void {
		const id = this.host.selectedClipId;
		const alive = new Set(
			this.host.lanes.flatMap((l) => l.clips.map((c) => c.id)),
		);
		untrack(() => {
			if (this.selectedJoins.length > 0) {
				const joins = this.#joinIds();
				const kept = this.selectedJoins.filter((j) => joins.has(j));
				if (kept.length !== this.selectedJoins.length)
					this.selectedJoins = kept;
			}
			const ids = this.host.selectedClipIds;
			if (!id || !alive.has(id)) {
				if (ids.length > 0) this.host.selectedClipIds = [];
				return;
			}
			const pruned = ids.filter((x) => alive.has(x));
			if (!pruned.includes(id)) this.host.selectedClipIds = [id];
			else if (pruned.length !== ids.length) this.host.selectedClipIds = pruned;
		});
	}

	/** Every selected clip, across lanes. */
	get selectedClips(): C[] {
		const ids = this.host.selectedClipIds;
		return this.host.lanes.flatMap((l) =>
			l.clips.filter((c) => ids.includes(c.id)),
		);
	}

	/** The raw pointer time; a drag snaps it against the stack in dragClipsStep. */
	timeAt(clientX: number): number {
		return this.stack.vp.clientXToTime(clientX);
	}

	laneOf(laneId: string): L | undefined {
		return this.host.lanes.find((l) => l.id === laneId);
	}

	/** Over the track rather than the row's gutter. A pixel of slack either side, since
	 * a box edge between two whole pixels would refuse a drop. */
	overTrack(clientX: number): boolean {
		if (!this.trackEl) return false;
		const rect = this.trackEl.getBoundingClientRect();
		return clientX >= rect.left - 1 && clientX <= rect.right + 1;
	}

	get #scale() {
		return {
			viewDuration: this.stack.vp.viewDuration,
			laneWidthPx: this.stack.laneWidth,
		};
	}

	clipPx(span: { start: number; end: number }): number {
		return clipPx(span, this.#scale);
	}

	edgeWidth(clip: C): number {
		return edgeWidth(clip, this.#scale);
	}

	boundaryWidth(left: C, right: C): number {
		return boundaryWidth(left, right, this.#scale);
	}

	adjacentPairs(lane: L): AdjacentPair<C>[] {
		return adjacentPairs(lane);
	}

	update(laneId: string, fn: (lane: L) => L): void {
		this.host.setLanes(updateLaneIn(this.host.lanes, laneId, fn));
	}

	setLane<K extends keyof L>(laneId: string, key: K, value: L[K]): void {
		this.host.onBeforeEdit?.();
		this.update(laneId, (l) => ({ ...l, [key]: value }));
	}

	/** An empty lane takes nothing with it, so it goes without asking. */
	requestDeleteLane(lane: L): void {
		if (lane.clips.length === 0) this.deleteLane(lane.id);
		else this.lanePendingDelete = lane;
	}

	deleteLane(laneId: string): void {
		this.lanePendingDelete = null;
		this.host.onBeforeEdit?.();
		// The lane id is its audio-link scope; its envelopes outlive it otherwise.
		dropAutoRangeScope(laneId);
		this.host.setLanes(this.host.lanes.filter((l) => l.id !== laneId));
	}

	/** The span a clip added at `time` gets. */
	clipSpanAt(lane: L, time: number): { start: number; end: number } | null {
		if (this.host.clipSpanAt) return this.host.clipSpanAt(lane, time);
		const gap = freeRangeAt(lane, time, this.trackDuration);
		if (!gap) return null;
		const start = Math.max(
			gap.start,
			Math.min(time, gap.end - MIN_CLIP_LENGTH),
		);
		return {
			start,
			end: Math.min(start + this.host.defaultClipLength, gap.end),
		};
	}

	addClipAt(laneId: string, time: number): void {
		const lane = this.laneOf(laneId);
		if (!lane) return;
		const span = this.clipSpanAt(lane, time);
		if (!span) return;
		const clip = this.host.createClip(span.start, span.end);
		this.host.onBeforeEdit?.();
		this.update(laneId, (l) => addClip(l, clip, this.trackDuration));
		this.selectOnly(clip.id);
	}

	/** Put a full-length clip on a lane that has none, and select it. */
	addFullClip(laneId: string): void {
		if (this.trackDuration <= 0) return;
		const clip = this.host.createClip(0, this.trackDuration);
		this.host.onBeforeEdit?.();
		this.update(laneId, (l) => addClip(l, clip, this.trackDuration));
		this.selectOnly(clip.id);
	}

	/** Aim the panel at a lane: its first clip, or a fresh full-length one when it has
	 * none. */
	openLane(lane: L): void {
		const first = sortClips(lane.clips)[0];
		if (first) this.selectOnly(first.id);
		else this.addFullClip(lane.id);
	}

	/** Cut the clip under `time` on one lane in two, the S shortcut's target. */
	splitAt(laneId: string, time: number): void {
		const lane = this.laneOf(laneId);
		if (!lane) return;
		const next = this.host.splitClipAt(lane, time);
		// Not inside a clip, or one half would be too short to keep.
		if (next === lane) return;
		this.host.onBeforeEdit?.();
		this.update(laneId, () => next);
		// The clip the cursor was in is gone; leaving its id selected would show a stale chain.
		this.deselect();
	}

	deleteClip(laneId: string, clipId: string): void {
		this.host.onBeforeEdit?.();
		this.update(laneId, (l) => removeClip(l, clipId));
		if (this.host.selectedClipId === clipId) this.host.selectedClipId = null;
	}

	/** Delete every selected clip, across lanes, as one undo step. */
	deleteSelection(): void {
		const ids = new Set(this.host.selectedClipIds);
		if (ids.size === 0) return;
		this.host.onBeforeEdit?.();
		this.host.setLanes(
			this.host.lanes.map((l) => ({
				...l,
				clips: l.clips.filter((c) => !ids.has(c.id)),
			})),
		);
		this.deselect();
	}

	/** Action for a lane's track element: registers it with the shared axis, as a split
	 * target for S, and its clip edges as snap targets. */
	laneTrack = (node: HTMLElement, laneId: string) => {
		this.trackEl = node;
		const shared = this.stack.lane(node, laneId);
		const unregister = this.stack.registerSplitter(laneId, (t) =>
			this.splitAt(laneId, t),
		);
		const unsnap = this.stack.registerSnapSource(laneId, () =>
			this.#snapPoints(laneId),
		);
		return {
			destroy: () => {
				shared.destroy();
				unregister();
				unsnap();
				if (this.trackEl === node) this.trackEl = undefined;
			},
		};
	};

	#snapPoints(laneId: string): SnapPoint[] {
		const lane = this.laneOf(laneId);
		const edges = laneSnapPoints(lane);
		const ends = this.host.sourceEnds;
		if (!lane || !ends) return edges;
		return edges.concat(
			lane.clips.flatMap((clip) =>
				ends(clip, lane, this.trackDuration).map((time) => ({
					time,
					ownerId: sourceEndOwner(clip.id),
				})),
			),
		);
	}

	onTrackDblClick(e: MouseEvent, laneId: string): void {
		if (this.trackDuration <= 0) return;
		// A double-click inside a clip is the clip's business; only empty lane space adds one.
		if ((e.target as HTMLElement | null)?.closest?.(".clip")) return;
		this.addClipAt(laneId, this.timeAt(e.clientX));
	}

	onClipPointerDown(
		e: PointerEvent,
		laneId: string,
		clipId: string,
		mode: ClipEdgeMode,
	): void {
		if (e.button !== 0) return;
		e.stopPropagation();
		if (this.#pasteClick(e, laneId)) return;
		this.#clickOnUp = null;
		const host = this.host;

		// Selection gestures first, and none of them start a drag, since dragging from one
		// would move clips the user was only trying to pick.
		if ((e.ctrlKey || e.metaKey) && e.shiftKey && mode === "move") {
			if (host.selectedClipIds.includes(clipId)) {
				const rest = host.selectedClipIds.filter((x) => x !== clipId);
				host.selectedClipIds = rest;
				if (host.selectedClipId === clipId)
					host.selectedClipId = rest[rest.length - 1] ?? null;
			} else {
				host.selectedClipIds = [...host.selectedClipIds, clipId];
				host.selectedClipId = clipId;
			}
			return;
		}

		// Ctrl+Click cuts at the cursor, on the edge handles too.
		if (e.ctrlKey || e.metaKey) {
			this.splitAt(laneId, this.timeAt(e.clientX));
			return;
		}

		// Shift: a drag boxes clips in, a click extends the selection from the primary.
		if (e.shiftKey && mode === "move") {
			this.#startBox(e, laneId, clipId);
			return;
		}

		// A plain click on something already selected keeps it so it can be dragged.
		if (host.selectedClipIds.includes(clipId) && mode === "move") {
			host.selectedClipId = clipId;
			this.#clickOnUp = clipId;
		} else {
			this.selectOnly(clipId);
		}

		const clip = this.laneOf(laneId)?.clips.find((c) => c.id === clipId);
		if (!clip) return;
		this.drag = {
			laneId,
			clipId,
			mode,
			grabOffset: this.timeAt(e.clientX) - clip.start,
		};
		// One undo entry per gesture, not per pointermove.
		host.onBeforeEdit?.(`${host.kind}-${mode}-${clipId}`);
		(e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
	}

	onBoundaryPointerDown(
		e: PointerEvent,
		laneId: string,
		leftId: string,
		rightId: string,
	): void {
		if (e.button !== 0) return;
		e.preventDefault();
		e.stopPropagation();
		if (this.#pasteClick(e, laneId)) return;
		const joins = !!this.host.onJoinClick;
		if (joins && e.shiftKey) {
			this.#selectJoinsOnly(
				this.selectedJoins.includes(rightId)
					? this.selectedJoins.filter((j) => j !== rightId)
					: [...this.selectedJoins, rightId],
			);
			return;
		}
		const target = e.currentTarget as HTMLElement;
		if (
			joins &&
			this.selectedJoins.length > 1 &&
			this.selectedJoins.includes(rightId)
		) {
			const group = joinRefs(this.host.lanes, this.selectedJoins);
			this.#joinGroup = {
				joins: group,
				anchor: this.timeAt(e.clientX),
				...joinDeltaLimits(this.host.lanes, group),
			};
			this.#joinPress = { rightId, anchor: target.getBoundingClientRect() };
			this.#pendingEditKey = `${this.host.kind}-joins-${rightId}`;
			target.setPointerCapture(e.pointerId);
			return;
		}
		this.drag = {
			laneId,
			clipId: leftId,
			otherId: rightId,
			mode: "boundary",
			grabOffset: 0,
		};
		this.#joinPress = joins
			? { rightId, anchor: target.getBoundingClientRect() }
			: null;
		// One undo entry per gesture, taken once it moves.
		this.#pendingEditKey = `${this.host.kind}-boundary-${leftId}`;
		target.setPointerCapture(e.pointerId);
	}

	/** Empty lane space places the start marker, which takes the clock with it: with no
	 * ruler row, every lane has to be draggable. */
	onLanePointerDown(e: PointerEvent, laneId: string): void {
		if (e.button !== 0 || this.trackDuration <= 0) return;
		if ((e.target as HTMLElement | null)?.closest?.(".clip")) return;
		if (this.#pasteClick(e, laneId)) return;
		if (e.ctrlKey || e.metaKey) {
			e.preventDefault();
			this.addClipAt(laneId, this.timeAt(e.clientX));
			return;
		}
		if (e.shiftKey) {
			e.preventDefault();
			this.#startBox(e, laneId, null);
			return;
		}
		this.selectedJoins = [];
		this.scrubbing = true;
		(e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
		this.stack.seekStatic(this.timeAt(e.clientX));
	}

	/** Joins picked on their own: the clips step aside so Ctrl+C takes the joins. */
	#selectJoinsOnly(ids: string[]): void {
		this.host.selectedClipIds = [];
		this.host.selectedClipId = null;
		this.selectedJoins = ids;
	}

	/** This controller's lanes as they stack on screen, top to bottom. */
	#laneOrder(): string[] {
		return this.stack
			.laneIdsBetween(-Infinity, Infinity)
			.filter((id) => this.laneOf(id));
	}

	#copyJoins(): boolean {
		if (!this.host.onJoinClick || this.selectedJoins.length === 0) return false;
		const read = this.host.readJoin ?? (() => undefined);
		this.joinClipboard = copyJoins(
			this.host.lanes,
			joinRefs(this.host.lanes, this.selectedJoins),
			this.#laneOrder(),
			read,
		);
		if (this.joinClipboard.length === 0) return false;
		this.#joinStamp = markCopied();
		return true;
	}

	/** Arm the paste; the next click on a lane lays the joins down there. */
	#armJoinPaste(): boolean {
		if (this.joinClipboard.length === 0 || latestCopy() !== this.#joinStamp) {
			return false;
		}
		this.pastingJoins = true;
		return true;
	}

	cancelJoinPaste(): void {
		this.pastingJoins = false;
		this.pasteCursor = null;
	}

	/** The times the armed paste would cut `laneId` at, for its ghost. */
	pasteGhost(laneId: string): number[] {
		const cursor = this.pasteCursor;
		if (!this.pastingJoins || !cursor) return [];
		return joinPastePoints(
			this.joinClipboard,
			this.#laneOrder(),
			cursor.laneId,
			cursor.time,
			this.trackDuration,
		)
			.filter((p) => p.laneId === laneId)
			.map((p) => p.at);
	}

	/** A click while a paste is armed lays it down; true when it did. */
	#pasteClick(e: PointerEvent, laneId: string): boolean {
		if (!this.pastingJoins) return false;
		e.preventDefault();
		e.stopPropagation();
		const points = joinPastePoints(
			this.joinClipboard,
			this.#laneOrder(),
			laneId,
			this.timeAt(e.clientX),
			this.trackDuration,
		);
		this.cancelJoinPaste();
		if (points.length === 0) return true;
		const write = this.host.writeJoin ?? ((c: C) => c);
		this.host.onBeforeEdit?.();
		const pasted = pasteJoins(
			this.host.lanes,
			points,
			(lane, at) => this.host.splitClipAt(lane, at),
			write,
		);
		this.host.setLanes(pasted.lanes);
		this.#selectJoinsOnly(pasted.rightIds);
		return true;
	}

	#startBox(e: PointerEvent, laneId: string, clipId: string | null): void {
		this.#boxStart = {
			time: this.timeAt(e.clientX),
			x: e.clientX,
			y: e.clientY,
			laneId,
			clipId,
		};
		(e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
	}

	/** This controller's lanes the box spans, top to bottom on screen. */
	#boxLanes(y0: number, y1: number, startLaneId: string): string[] {
		const mine = this.stack
			.laneIdsBetween(y0, y1)
			.filter((id) => this.laneOf(id));
		return mine.length > 0 ? mine : [startLaneId];
	}

	#endBox(): void {
		const start = this.#boxStart!;
		const box = this.marquee;
		this.#boxStart = null;
		this.marquee = null;
		const host = this.host;
		if (!box) {
			// A shift-click: extend from the primary, or clear on empty space.
			if (!start.clipId) return this.deselect();
			const lane = this.laneOf(start.laneId);
			const range =
				lane && host.selectedClipId
					? clipRange(lane, host.selectedClipId, start.clipId)
					: [];
			if (range.length > 0) host.selectedClipIds = range;
			else this.selectOnly(start.clipId);
			return;
		}
		const lanes = box.laneIds
			.map((id) => this.laneOf(id))
			.filter((l): l is L => !!l);
		const ids = lanes.flatMap((l) =>
			sortClips(l.clips)
				.filter((c) => c.end > box.from && c.start < box.to)
				.map((c) => c.id),
		);
		host.selectedClipIds = ids;
		host.selectedClipId = ids[0] ?? null;
		this.selectedJoins = host.onJoinClick
			? lanes.flatMap((l) =>
					adjacentPairs(l)
						.filter((p) => p.at >= box.from && p.at <= box.to)
						.map((p) => p.right.id),
				)
			: [];
	}

	onPointerMove(e: PointerEvent): void {
		if (this.pastingJoins) {
			const over = this.stack.laneIdAt(e.clientY);
			if (over && this.laneOf(over)) {
				this.pasteCursor = { laneId: over, time: this.timeAt(e.clientX) };
			}
			return;
		}
		const moving = this.#joinGroup;
		if (moving) {
			this.#joinPress = null;
			if (this.#pendingEditKey) {
				this.host.onBeforeEdit?.(this.#pendingEditKey);
				this.#pendingEditKey = null;
			}
			const raw = this.timeAt(e.clientX) - moving.anchor;
			const own = new Set(
				moving.joins.flatMap((j) => [
					j.leftId,
					j.rightId,
					sourceEndOwner(j.rightId),
				]),
			);
			const shift = this.stack.snapShift(
				moving.joins.map((j) => j.at + raw),
				own,
				e.altKey,
			);
			const delta = Math.max(moving.min, Math.min(moving.max, raw + shift));
			this.host.setLanes(moveJoins(this.host.lanes, moving.joins, delta));
			this.stack.confirmSnap(moving.joins.map((j) => j.at + delta));
			return;
		}
		const box = this.#boxStart;
		if (box) {
			// A few pixels of slack, so a shaky shift-click stays a click.
			if (!this.marquee && Math.abs(e.clientX - box.x) < 3) return;
			const t = this.timeAt(e.clientX);
			this.marquee = {
				laneIds: this.#boxLanes(box.y, e.clientY, box.laneId),
				from: Math.max(0, Math.min(box.time, t)),
				to: Math.min(this.trackDuration, Math.max(box.time, t)),
			};
			return;
		}
		if (this.scrubbing) this.stack.seekStatic(this.timeAt(e.clientX));
		const drag = this.drag;
		if (!drag) return;
		const t = this.timeAt(e.clientX);
		const { laneId, clipId, mode, grabOffset } = drag;
		this.#clickOnUp = null;
		this.#joinPress = null;
		if (this.#pendingEditKey) {
			this.host.onBeforeEdit?.(this.#pendingEditKey);
			this.#pendingEditKey = null;
		}
		const lanes = this.host.lanes;
		const group = this.host.selectedClipIds.includes(clipId)
			? this.host.selectedClipIds
			: [clipId];
		// A move that crossed into another row of this kind carries the clips over, if they
		// fit; otherwise they keep sliding on the row they came from.
		if (mode === "move") {
			const over = this.stack.laneIdAt(e.clientY);
			const from = this.laneOf(laneId);
			const held = from?.clips.find((c) => c.id === clipId);
			if (over && over !== laneId && this.laneOf(over) && from && held) {
				const next = moveClipsToLane(
					lanes,
					laneId,
					over,
					group,
					t - grabOffset - held.start,
					this.trackDuration,
					this.host.remapOnLaneChange,
					this.stack.crossLaneTolerance(
						from.clips.filter((c) => group.includes(c.id)),
					),
				);
				if (next !== lanes) {
					drag.laneId = over;
					this.host.setLanes(next);
					return;
				}
			}
		}
		// Dragging any member drags the whole selection. Alt holds the snap off.
		const step = dragClipsStep(
			this.laneOf(laneId)!,
			drag,
			t,
			this.host.selectedClipIds,
			this.trackDuration,
			(edges, exclude) => this.stack.snapShift(edges, exclude, e.altKey),
		);
		this.update(laneId, () => step.lane);
		this.stack.confirmSnap(step.edges);
	}

	onPointerUp(e: PointerEvent): void {
		if (this.#boxStart) {
			this.#endBox();
			(e.currentTarget as HTMLElement).releasePointerCapture?.(e.pointerId);
			return;
		}
		const press = this.#joinPress;
		this.#joinPress = null;
		this.#pendingEditKey = null;
		if (this.#joinGroup) {
			this.#joinGroup = null;
			this.stack.endSnap();
			(e.currentTarget as HTMLElement).releasePointerCapture?.(e.pointerId);
		}
		if (press) {
			// Clicking one of several selected joins edits them all.
			const inSelection = this.selectedJoins.includes(press.rightId);
			const joins =
				inSelection && this.selectedJoins.length > 1
					? this.selectedJoins
					: [press.rightId];
			this.#selectJoinsOnly(inSelection ? this.selectedJoins : [press.rightId]);
			this.host.onJoinClick?.(joins, press.anchor);
		}
		const clickOnUp = this.#clickOnUp;
		if (clickOnUp) {
			// Clicking the one selected clip again drops the selection.
			const ids = this.host.selectedClipIds;
			const sole = ids.length === 1 && ids[0] === clickOnUp;
			if (sole) this.deselect();
			else this.selectOnly(clickOnUp);
			this.#clickOnUp = null;
		}
		this.scrubbing = false;
		if (!this.drag) return;
		this.drag = null;
		this.stack.endSnap();
		(e.currentTarget as HTMLElement).releasePointerCapture?.(e.pointerId);
	}

	onKeyDown(e: KeyboardEvent): void {
		if (isTextEntryTarget(e.target)) return;
		// The media lightbox and other overlays own the keyboard while they're up.
		if (isModalKeyboardOpen()) return;
		if (e.ctrlKey || e.metaKey) {
			const key = e.key.toLowerCase();
			// Clips come first; joins copy when they're all that's picked.
			if (
				(key === "c" && (this.host.copy() || this.#copyJoins())) ||
				(key === "v" && (this.#armJoinPaste() || this.host.paste()))
			) {
				e.preventDefault();
				e.stopPropagation();
			}
			return;
		}
		if (e.key === "Escape" && this.pastingJoins) {
			this.cancelJoinPaste();
			return;
		}
		if (
			e.key === "Escape" &&
			(this.host.selectedClipIds.length > 0 || this.selectedJoins.length > 0)
		) {
			this.deselect();
			return;
		}
		if (e.key !== "Delete" && e.key !== "Backspace") return;
		if (this.host.selectedClipIds.length === 0) return;
		e.preventDefault();
		this.deleteSelection();
	}
}
