/**
 * What every clip lane component does the same way: which clips are selected
 * and how a click changes that, dragging clips and boundaries, scrubbing on
 * empty lane space, adding and splitting at the cursor, deleting, and the
 * keyboard. The fx, media and text lanes each hand this a `host` describing
 * what a clip is on their lane and keep only their own markup and gestures.
 *
 * Lanes are read through the host's getter on every call, so the controller
 * always sees the component's current props; edits go back through
 * `setLanes` after `onBeforeEdit` has recorded the state they replace.
 */

import { untrack } from "svelte";
import type { TimelineStackState } from "../editor/timeline-stack.svelte";
import { isTextEntryTarget } from "../editor/shortcut-target";
import { isModalKeyboardOpen } from "../modal-keyboard";
import { dropAutoRangeScope } from "../audio/auto-range";
import { dragClipsStep, laneSnapPoints, type ClipDrag } from "./clip-drag";
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
	/** The primary selection — the one the panel edits and a shift-range
	 * extends from — and the whole selection it is always a member of. */
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
	/** The lane geometry, for hit-testing against the track. Every lane shares
	 * one geometry, so whichever mounted last will do. */
	trackEl: HTMLElement | undefined;

	/** Set on pointerdown when a plain click landed on an already-selected
	 * clip. The selection has to survive until pointerup so the clip (or the
	 * group) can still be dragged; only a click that turns out not to be a
	 * drag resolves it — a group collapses to the one clicked, a lone clip
	 * deselects. */
	#clickOnUp: string | null = null;

	constructor(host: ClipLaneHost<C, L>, stack: TimelineStackState) {
		this.host = host;
		this.stack = stack;
	}

	get trackDuration(): number {
		return this.stack.trackDuration;
	}

	// ── Selection ────────────────────────────────────────────────────────────

	selectOnly(clipId: string): void {
		this.host.selectedClipId = clipId;
		this.host.selectedClipIds = [clipId];
		this.host.onSelectOnly?.();
	}

	deselect(): void {
		this.host.selectedClipId = null;
		this.host.selectedClipIds = [];
	}

	/** Follow external changes to the primary (the panel's back button,
	 * applied lyrics) and drop ids whose clips are gone. Call from an effect. */
	syncSelection(): void {
		const id = this.host.selectedClipId;
		const alive = new Set(
			this.host.lanes.flatMap((l) => l.clips.map((c) => c.id)),
		);
		untrack(() => {
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

	// ── Lookups ──────────────────────────────────────────────────────────────

	/** The raw pointer time; a drag snaps it against the stack in dragClipsStep. */
	timeAt(clientX: number): number {
		return this.stack.vp.clientXToTime(clientX);
	}

	laneOf(laneId: string): L | undefined {
		return this.host.lanes.find((l) => l.id === laneId);
	}

	/** Over the track rather than the row's gutter. A pixel of slack either
	 * side: the mouse lands on whole pixels, and a box edge that falls between
	 * two would otherwise refuse a drop aimed at the very start of the lane. */
	overTrack(clientX: number): boolean {
		if (!this.trackEl) return false;
		const rect = this.trackEl.getBoundingClientRect();
		return clientX >= rect.left - 1 && clientX <= rect.right + 1;
	}

	// ── Geometry ─────────────────────────────────────────────────────────────

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

	// ── Edits ────────────────────────────────────────────────────────────────

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

	/** Aim the panel at a lane: its first clip, or a fresh full-length one when
	 * it has none — a lane whose clips were all deleted has nothing to select
	 * and no other way back. */
	openLane(lane: L): void {
		const first = sortClips(lane.clips)[0];
		if (first) this.selectOnly(first.id);
		else this.addFullClip(lane.id);
	}

	/** Cut the clip under `time` on one lane in two — the S shortcut's target. */
	splitAt(laneId: string, time: number): void {
		const lane = this.laneOf(laneId);
		if (!lane) return;
		const next = this.host.splitClipAt(lane, time);
		// Not inside a clip, or one half would be too short to keep.
		if (next === lane) return;
		this.host.onBeforeEdit?.();
		this.update(laneId, () => next);
		// The clip the cursor was in is gone; leaving its id selected would show
		// the panel a chain that is no longer on the lane.
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

	// ── Lane track ───────────────────────────────────────────────────────────

	/** Action for a lane's track element: registers it with the shared axis,
	 * as a split target for the S shortcut, and its clip edges as snap targets
	 * for drags on any lane. An action, not an attachment, for the reason
	 * `TimelineStackState.lane` is. */
	laneTrack = (node: HTMLElement, laneId: string) => {
		this.trackEl = node;
		const shared = this.stack.lane(node, laneId);
		const unregister = this.stack.registerSplitter(laneId, (t) =>
			this.splitAt(laneId, t),
		);
		const unsnap = this.stack.registerSnapSource(laneId, () =>
			laneSnapPoints(this.laneOf(laneId)),
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

	// ── Pointer ──────────────────────────────────────────────────────────────

	onTrackDblClick(e: MouseEvent, laneId: string): void {
		if (this.trackDuration <= 0) return;
		// A double-click inside a clip is the clip's business; only empty lane
		// space drops a new clip.
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
		this.#clickOnUp = null;
		const host = this.host;

		// Selection gestures first, and none of them start a drag — dragging from
		// one would move clips the user was only trying to pick.
		//
		// Ctrl+Shift toggles a single clip in or out: the additive pick that plain
		// Ctrl used to be, moved aside so Ctrl+Click can split. Checked before the
		// plain-Shift range, which would otherwise swallow it.
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

		// Ctrl+Click cuts at the cursor. Handled on the edge handles too: they sit
		// over the clip's ends, and a cut there is no less unambiguous.
		if (e.ctrlKey || e.metaKey) {
			this.splitAt(laneId, this.timeAt(e.clientX));
			return;
		}

		// Shift extends the selection from the primary.
		if (e.shiftKey && mode === "move") {
			const lane = this.laneOf(laneId);
			if (lane && host.selectedClipId) {
				const range = clipRange(lane, host.selectedClipId, clipId);
				if (range.length > 0) {
					host.selectedClipIds = range;
					return;
				}
			}
			this.selectOnly(clipId);
			return;
		}

		// A plain click on something already selected keeps the selection, so it
		// can be dragged; pointerup resolves it if nothing moved.
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
		this.drag = {
			laneId,
			clipId: leftId,
			otherId: rightId,
			mode: "boundary",
			grabOffset: 0,
		};
		// One undo entry per gesture, not per pointermove.
		this.host.onBeforeEdit?.(`${this.host.kind}-boundary-${leftId}`);
		(e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
	}

	/** Empty lane space places the start marker, which takes the clock with
	 * it: with no ruler row of its own, every lane has to be draggable, or a
	 * text-only timeline has nothing to seek with. Ctrl/Cmd drops a clip there
	 * instead — a one-handed alternative to double-clicking. */
	onLanePointerDown(e: PointerEvent, laneId: string): void {
		if (e.button !== 0 || this.trackDuration <= 0) return;
		if ((e.target as HTMLElement | null)?.closest?.(".clip")) return;
		if (e.ctrlKey || e.metaKey) {
			e.preventDefault();
			this.addClipAt(laneId, this.timeAt(e.clientX));
			return;
		}
		this.scrubbing = true;
		(e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
		this.stack.seekStatic(this.timeAt(e.clientX));
	}

	onPointerMove(e: PointerEvent): void {
		if (this.scrubbing) this.stack.seekStatic(this.timeAt(e.clientX));
		const drag = this.drag;
		if (!drag) return;
		const t = this.timeAt(e.clientX);
		const { laneId, clipId, mode, grabOffset } = drag;
		this.#clickOnUp = null;
		const lanes = this.host.lanes;
		const group = this.host.selectedClipIds.includes(clipId)
			? this.host.selectedClipIds
			: [clipId];
		// A move that crossed into another row of this kind carries the clips
		// over, if they fit there; otherwise they keep sliding on the row they
		// came from. From then on the drag belongs to the new lane.
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
		// Dragging any member drags the whole selection with it. Alt holds the
		// snap off.
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

	// ── Keyboard ─────────────────────────────────────────────────────────────

	onKeyDown(e: KeyboardEvent): void {
		if (isTextEntryTarget(e.target)) return;
		// The media lightbox and other overlays own the keyboard while they're
		// up: Escape and Delete must not reach the clips behind them.
		if (isModalKeyboardOpen()) return;
		if (e.ctrlKey || e.metaKey) {
			const key = e.key.toLowerCase();
			if (
				(key === "c" && this.host.copy()) ||
				(key === "v" && this.host.paste())
			) {
				e.preventDefault();
				e.stopPropagation();
			}
			return;
		}
		if (e.key === "Escape" && this.host.selectedClipIds.length > 0) {
			this.deselect();
			return;
		}
		if (e.key !== "Delete" && e.key !== "Backspace") return;
		if (this.host.selectedClipIds.length === 0) return;
		e.preventDefault();
		this.deleteSelection();
	}
}
