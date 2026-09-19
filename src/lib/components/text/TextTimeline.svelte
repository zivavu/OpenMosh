<script lang="ts">
	import { ChevronDown, Eye, EyeOff, Trash2 } from "lucide-svelte";
	import { untrack } from "svelte";
	import { dropAutoRangeScope } from "../../audio/auto-range";
	import { getTimelineStack } from "../../editor/timeline-stack.svelte";
	import {
		dragClipsStep,
		laneSnapPoints,
		type ClipDrag,
	} from "../../timeline/clip-drag";
	import { latestCopy, markCopied } from "../../editor/copy-stamp";
	import { isTextEntryTarget } from "../../editor/shortcut-target";
	import { isModalKeyboardOpen } from "../../modal-keyboard";
	import {
		addClip,
		clipRange,
		copyTextClips,
		createTextClip,
		createTextLane,
		freeRangeAt,
		lyricsDraftFromTimeline,
		MIN_CLIP_LENGTH,
		moveClipsToLane,
		pasteTextClips,
		pasteTextOnto,
		removeClip,
		sortClips,
		updateLane,
		splitTextClipAt,
		type TextClip,
		type TextClipboardEntry,
		type TextLane,
		type TextTimeline,
	} from "../../text";
	import type { LyricsSyncProps } from "./LyricsSyncModal.svelte";
	import { lazy } from "../../lazy";
	import { stackIndex, type LayerRef } from "../../timeline/layer-order";
	import LaneGrip from "../ui/LaneGrip.svelte";
	import LaneName from "../ui/LaneName.svelte";
	import ConfirmDialog from "../ui/ConfirmDialog.svelte";

	// Only fetched when the sync modal is actually opened; it reseeds itself from
	// the timeline on every open, so mounting it late costs nothing.
	const loadLyricsSyncModal = lazy(() => import("./LyricsSyncModal.svelte"));

	/** Length a click-to-add clip gets, when the gap it lands in allows it. */
	const DEFAULT_CLIP_LENGTH = 6;
	const LANE_HEIGHT = 30;
	/** A folded lane: its clips are still there to read, but not at a height that
	 * pays for the text inside them. A floor, not a height: the strip fills its
	 * row, so the gutter controls never leave slack under it. */
	const LANE_FOLDED_HEIGHT = 14;
	/** Shared so an unfolded panel allocates nothing per instance. */
	const NO_FOLDS: ReadonlySet<string> = new Set();

	interface Props {
		timeline: TextTimeline;
		/** Every layer, front first — this lane's place in the stack. */
		layerOrder?: LayerRef[];
		/** Starts a row drag that reorders the whole layer stack. The editor owns
		 * it: a drag crosses into the other kind's rows, which this can't see. */
		onLaneDragStart?: (laneId: string, e: PointerEvent) => void;
		/** Id of the row being dragged right now, for its lifted look. */
		draggingLaneId?: string | null;
		/** Lanes the user has folded to a strip, by lane id. */
		foldedLaneIds?: ReadonlySet<string>;
		/** Fired when a lane's fold toggle is clicked. */
		onToggleFold?: (laneId: string) => void;
		selectedClipId?: string | null;
		onChange: (timeline: TextTimeline) => void;
		/** Called before a change lands, while the pre-edit state is intact. */
		onBeforeEdit?: (coalesceKey?: string) => void;
		/** When provided, the header grows a Lyrics button that opens the sync
		 * modal, wired to the mode's own transport. */
		lyricsSync?: LyricsSyncProps | null;
		/** External open/close of the sync modal (e.g. the editor's top bar). */
		lyricsOpen?: boolean;
	}

	let {
		timeline,
		layerOrder = [],
		onLaneDragStart,
		draggingLaneId = null,
		foldedLaneIds = NO_FOLDS,
		onToggleFold,
		selectedClipId = $bindable(null),
		onChange,
		onBeforeEdit,
		lyricsSync = null,
		lyricsOpen = $bindable(false),
	}: Props = $props();

	/** What the sync modal opens onto: the lyrics lane as the timeline holds it,
	 * so clips dragged here show up there with their nudged times. */
	let lyricsDraft = $derived(lyricsDraftFromTimeline(timeline));

	// One axis for the whole stack: zoom, pan, playhead-following and the
	// duration-change reset all live in TimelineStack.
	const stack = getTimelineStack();
	const vp = stack.vp;
	let trackDuration = $derived(stack.trackDuration);

	/** The lane geometry, for sizing grab handles against their clips. */
	let trackEl = $state<HTMLElement | undefined>(undefined);

	/** Registers a lane track with the shared axis and keeps a local handle on
	 * it — every lane shares one geometry, so whichever mounted last will do.
	 * The lane also registers itself as a split target for the S shortcut. */
	function laneTrack(node: HTMLElement, laneId: string) {
		trackEl = node;
		const shared = stack.lane(node, laneId);
		const unregister = stack.registerSplitter(laneId, (t) =>
			splitAt(laneId, t),
		);
		// Its clip edges are snap targets for drags on any lane.
		const unsnap = stack.registerSnapSource(laneId, () =>
			laneSnapPoints(laneOf(laneId)),
		);
		return {
			destroy() {
				shared.destroy();
				unregister();
				unsnap();
				if (trackEl === node) trackEl = undefined;
			},
		};
	}

	let drag = $state<ClipDrag | null>(null);

	/**
	 * The whole selection. `selectedClipId` stays the primary — the one the clip
	 * panel edits and the anchor a shift-range extends from — and is always a
	 * member of this list.
	 */
	let selectedIds = $state<string[]>([]);
	/** Set on pointerdown when a plain click landed on an already-selected clip.
	 * The selection has to survive until pointerup so the clip (or the group) can
	 * still be dragged; only a click that turns out not to be a drag resolves it —
	 * a group collapses to the one clicked, a lone clip deselects. */
	let clickOnUp: string | null = null;

	function selectOnly(clipId: string) {
		selectedClipId = clipId;
		selectedIds = [clipId];
	}

	function deselect() {
		selectedClipId = null;
		selectedIds = [];
	}

	// Follow external changes to the primary (applying lyrics, the panel's back
	// button), and drop ids whose clips are gone.
	$effect(() => {
		const id = selectedClipId;
		const alive = new Set(
			timeline.lanes.flatMap((l) => l.clips.map((c) => c.id)),
		);
		untrack(() => {
			if (!id || !alive.has(id)) {
				if (selectedIds.length > 0) selectedIds = [];
				return;
			}
			const pruned = selectedIds.filter((x) => alive.has(x));
			if (!pruned.includes(id)) selectedIds = [id];
			else if (pruned.length !== selectedIds.length) selectedIds = pruned;
		});
	});

	/** The raw pointer time; a drag snaps it against the stack in dragClipsStep. */
	function timeAt(clientX: number): number {
		return vp.clientXToTime(clientX);
	}

	/** This lane's place in the stack that spans both kinds of layer. */
	function stackAt(laneId: string): number {
		return stackIndex(layerOrder, laneId);
	}

	function laneOf(laneId: string): TextLane | undefined {
		return timeline.lanes.find((l) => l.id === laneId);
	}

	/** Lane the delete button is asking about; null when nothing is pending. */
	let lanePendingDelete = $state<TextLane | null>(null);

	/** An empty lane takes nothing with it, so it goes without asking. */
	function requestDeleteLane(lane: TextLane) {
		if (lane.clips.length === 0) deleteLane(lane.id);
		else lanePendingDelete = lane;
	}

	function deleteLane(laneId: string) {
		lanePendingDelete = null;
		onBeforeEdit?.();
		// The lane id is its audio-link scope; its envelopes outlive it otherwise.
		dropAutoRangeScope(laneId);
		onChange({
			...timeline,
			lanes: timeline.lanes.filter((l) => l.id !== laneId),
		});
	}

	function setLane<K extends keyof TextLane>(
		laneId: string,
		key: K,
		value: TextLane[K],
	) {
		onBeforeEdit?.();
		onChange(updateLane(timeline, laneId, (l) => ({ ...l, [key]: value })));
	}

	/** Aim the sidebar at the lane: its first clip, or a fresh one spanning
	 * the track when it has none — the style and chain are the lane's, so any
	 * clip opens them. */
	function openLane(lane: TextLane) {
		const first = sortClips(lane.clips)[0];
		if (first) {
			selectOnly(first.id);
			return;
		}
		if (trackDuration <= 0) return;
		const clip = createTextClip(0, trackDuration, "TEXT");
		onBeforeEdit?.();
		onChange(
			updateLane(timeline, lane.id, (l) => addClip(l, clip, trackDuration)),
		);
		selectOnly(clip.id);
	}

	function addClipAt(laneId: string, time: number) {
		const lane = laneOf(laneId);
		if (!lane) return;
		const gap = freeRangeAt(lane, time, trackDuration);
		if (!gap) return;
		const start = Math.max(
			gap.start,
			Math.min(time, gap.end - MIN_CLIP_LENGTH),
		);
		const end = Math.min(start + DEFAULT_CLIP_LENGTH, gap.end);
		const clip = createTextClip(start, end, "TEXT");
		onBeforeEdit?.();
		onChange(
			updateLane(timeline, laneId, (l) => addClip(l, clip, trackDuration)),
		);
		selectOnly(clip.id);
	}

	/** Cut the clip under `time` on one lane in two — the S shortcut's target. */
	function splitAt(laneId: string, time: number) {
		const lane = laneOf(laneId);
		if (!lane) return;
		const next = splitTextClipAt(lane, time);
		// Not inside a clip, or one half would be too short to keep.
		if (next === lane) return;
		onBeforeEdit?.();
		onChange(updateLane(timeline, laneId, () => next));
		deselect();
	}

	function deleteClip(laneId: string, clipId: string) {
		onBeforeEdit?.();
		onChange(updateLane(timeline, laneId, (l) => removeClip(l, clipId)));
		if (selectedClipId === clipId) selectedClipId = null;
	}

	function onTrackDblClick(e: MouseEvent, laneId: string) {
		if (trackDuration <= 0) return;
		// A double-click inside a clip is the clip's business; only empty lane
		// space drops a new clip.
		if ((e.target as HTMLElement | null)?.closest?.(".clip")) return;
		addClipAt(laneId, timeAt(e.clientX));
	}

	function onClipPointerDown(
		e: PointerEvent,
		laneId: string,
		clipId: string,
		mode: "move" | "start" | "end",
	) {
		if (e.button !== 0) return;
		e.stopPropagation();
		clickOnUp = null;

		// Selection gestures first, and none of them start a drag — dragging from
		// one would move clips the user was only trying to pick.
		//
		// Ctrl+Shift toggles a single clip in or out: the additive pick that plain
		// Ctrl used to be, moved aside so Ctrl+Click can split the way it does on
		// the source and fx lanes. Checked before the plain-Shift range, which
		// would otherwise swallow it.
		if ((e.ctrlKey || e.metaKey) && e.shiftKey && mode === "move") {
			if (selectedIds.includes(clipId)) {
				const rest = selectedIds.filter((x) => x !== clipId);
				selectedIds = rest;
				if (selectedClipId === clipId)
					selectedClipId = rest[rest.length - 1] ?? null;
			} else {
				selectedIds = [...selectedIds, clipId];
				selectedClipId = clipId;
			}
			return;
		}

		// Ctrl+Click cuts at the cursor. Handled on the edge handles too: they sit
		// over the clip's ends, and a cut there is no less unambiguous.
		if (e.ctrlKey || e.metaKey) {
			splitAt(laneId, timeAt(e.clientX));
			return;
		}

		// Shift extends the selection from the primary.
		if (e.shiftKey && mode === "move") {
			const lane = laneOf(laneId);
			if (lane && selectedClipId) {
				const range = clipRange(lane, selectedClipId, clipId);
				if (range.length > 0) {
					selectedIds = range;
					return;
				}
			}
			selectOnly(clipId);
			return;
		}

		// A plain click on something already selected keeps the selection, so it
		// can be dragged; pointerup resolves it if nothing moved.
		if (selectedIds.includes(clipId) && mode === "move") {
			selectedClipId = clipId;
			clickOnUp = clipId;
		} else {
			selectOnly(clipId);
		}

		const clip = laneOf(laneId)?.clips.find((c) => c.id === clipId);
		if (!clip) return;
		drag = {
			laneId,
			clipId,
			mode,
			grabOffset: vp.clientXToTime(e.clientX) - clip.start,
		};
		// One undo entry per gesture, not per pointermove.
		onBeforeEdit?.(`text-${mode}-${clipId}`);
		(e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
	}

	function onBoundaryPointerDown(
		e: PointerEvent,
		laneId: string,
		leftId: string,
		rightId: string,
	) {
		if (e.button !== 0) return;
		e.preventDefault();
		e.stopPropagation();
		drag = {
			laneId,
			clipId: leftId,
			otherId: rightId,
			mode: "boundary",
			grabOffset: 0,
		};
		// One undo entry per gesture, not per pointermove.
		onBeforeEdit?.(`text-boundary-${leftId}`);
		(e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
	}

	/** Comfortable grab width for a shared boundary, in px. */
	const BOUNDARY_GRAB = 12;
	/** Comfortable grab width for a clip's own start/end handles, in px. */
	const EDGE_GRAB = 10;
	/**
	 * Below this the label is all ellipsis and no word — a lane of synced lyrics
	 * zoomed out becomes a row of "P…", which reads as noise rather than as text.
	 * The clip's tooltip still names it.
	 */
	const MIN_LABEL_PX = 34;

	/**
	 * Sized against the clip rather than fixed. At a flat 10px each, two handles
	 * overrun any clip under 20px wide and the right one is clipped away
	 * entirely — text set very small does exactly that. A third each keeps both
	 * edges grabbable at any width, and leaves the middle third to drag by.
	 */
	function edgeWidth(clip: TextClip): number {
		const px = clipPx(clip);
		if (px <= 0) return EDGE_GRAB;
		return Math.max(1, Math.min(EDGE_GRAB, px / 3));
	}

	/** The clip's on-screen width. */
	function clipPx(clip: TextClip): number {
		const px = trackEl?.getBoundingClientRect().width ?? 0;
		if (px <= 0) return 0;
		return ((clip.end - clip.start) / vp.viewDuration) * px;
	}

	/**
	 * A boundary is drawn over the clips either side of it, so a fixed grab area
	 * would blanket short clips entirely and leave nothing to click — which is
	 * every clip once a long lyric is zoomed out. Never take more than a third of
	 * the narrower neighbour.
	 */
	function boundaryWidth(left: TextClip, right: TextClip): number {
		const px = trackEl?.getBoundingClientRect().width ?? 0;
		if (px <= 0) return BOUNDARY_GRAB;
		const narrower = Math.min(left.end - left.start, right.end - right.start);
		const narrowerPx = (narrower / vp.viewDuration) * px;
		return Math.max(2, Math.min(BOUNDARY_GRAB, narrowerPx / 3));
	}

	/** Consecutive clip pairs sharing an exact edge — the draggable boundaries. */
	function adjacentPairs(
		lane: TextLane,
	): { left: TextClip; right: TextClip; at: number }[] {
		const clips = sortClips(lane.clips);
		const pairs: { left: TextClip; right: TextClip; at: number }[] = [];
		for (let i = 0; i + 1 < clips.length; i++) {
			if (clips[i].end === clips[i + 1].start) {
				pairs.push({ left: clips[i], right: clips[i + 1], at: clips[i].end });
			}
		}
		return pairs;
	}

	/** Empty lane space places the start marker, which takes the clock with it:
	 * with no ruler row of its own, every lane has to be draggable, or a
	 * text-only timeline has nothing to seek with. Ctrl/Cmd
	 * drops a clip there instead — the same gesture the sequence timeline uses,
	 * and a one-handed alternative to double-clicking. */
	function onLanePointerDown(e: PointerEvent, laneId: string) {
		if (e.button !== 0 || trackDuration <= 0) return;
		if ((e.target as HTMLElement | null)?.closest?.(".clip")) return;
		if (e.ctrlKey || e.metaKey) {
			e.preventDefault();
			addClipAt(laneId, timeAt(e.clientX));
			return;
		}
		scrubbing = true;
		(e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
		stack.seekStatic(timeAt(e.clientX));
	}

	function onPointerMove(e: PointerEvent) {
		if (scrubbing) stack.seekStatic(timeAt(e.clientX));
		if (!drag) return;
		const t = timeAt(e.clientX);
		const { laneId, clipId, mode, grabOffset } = drag;
		clickOnUp = null;
		// A move that crossed into another text row carries the clips over, if
		// they fit there; otherwise they keep sliding on the row they came from.
		// From then on the drag belongs to the new lane. The words travel and
		// the look stays: style is the lane's, so the clip takes the new one's.
		if (mode === "move") {
			const over = stack.laneIdAt(e.clientY);
			const held = laneOf(laneId)?.clips.find((c) => c.id === clipId);
			if (over && over !== laneId && laneOf(over) && held) {
				const group = selectedIds.includes(clipId) ? selectedIds : [clipId];
				const lanes = moveClipsToLane(
					timeline.lanes,
					laneId,
					over,
					group,
					t - grabOffset - held.start,
					trackDuration,
				);
				if (lanes !== timeline.lanes) {
					drag.laneId = over;
					onChange({ ...timeline, lanes });
					return;
				}
			}
		}
		// Dragging any member drags the whole selection with it. Alt holds the
		// snap off.
		const step = dragClipsStep(
			laneOf(laneId)!,
			drag,
			t,
			selectedIds,
			trackDuration,
			(edges, exclude) => stack.snapShift(edges, exclude, e.altKey),
		);
		onChange(updateLane(timeline, laneId, () => step.lane));
		stack.confirmSnap(step.edges);
	}

	function onPointerUp(e: PointerEvent) {
		if (clickOnUp) {
			// Clicking the one selected clip again drops the selection.
			const sole = selectedIds.length === 1 && selectedIds[0] === clickOnUp;
			if (sole) deselect();
			else selectOnly(clickOnUp);
			clickOnUp = null;
		}
		scrubbing = false;
		if (!drag) return;
		drag = null;
		stack.endSnap();
		(e.currentTarget as HTMLElement).releasePointerCapture?.(e.pointerId);
	}

	let scrubbing = $state(false);

	/** Delete every selected clip, across lanes, as one undo step. */
	function deleteSelection() {
		const ids = new Set(selectedIds);
		if (ids.size === 0) return;
		onBeforeEdit?.();
		onChange({
			...timeline,
			lanes: timeline.lanes.map((l) => ({
				...l,
				clips: l.clips.filter((c) => !ids.has(c.id)),
			})),
		});
		deselect();
	}

	// ── Clip clipboard ───────────────────────────────────────────────────────
	// Same shape as the media lane's: a paste goes onto the selection when
	// there is one — the words, into clips that keep their spans — and
	// otherwise stamps whole clips down at the start marker.
	let clipboard: TextClipboardEntry[] = [];
	/** What the clipboard was copied from, plus every copy stamped from it
	 * since: pasting onto exactly those would change nothing, so that gesture
	 * stamps new copies instead. */
	let copiedIds = new Set<string>();
	/** The copy stamp when the clipboard was last filled: a paste answers only
	 * if nothing was copied on another lane since. */
	let clipStamp = -1;

	function copySelection(): boolean {
		clipboard = copyTextClips(timeline, selectedIds);
		if (clipboard.length === 0) return false;
		copiedIds = new Set(selectedIds);
		clipStamp = markCopied();
		return true;
	}

	function pasteClipboard(): boolean {
		if (clipboard.length === 0 || latestCopy() !== clipStamp) return false;
		const ontoSelf =
			selectedIds.length > 0 && selectedIds.every((id) => copiedIds.has(id));
		if (selectedIds.length > 0 && !ontoSelf) {
			onBeforeEdit?.();
			onChange(pasteTextOnto(timeline, selectedIds, clipboard));
			return true;
		}
		return pasteClips();
	}

	/** Stamp the copied clips at the start marker, on the lane last clicked,
	 * and leave the copies selected to drag from there. */
	function pasteClips(): boolean {
		const result = pasteTextClips(
			timeline,
			clipboard,
			stack.staticTime,
			trackDuration,
			stack.activeLaneId,
		);
		if (result.clipIds.length === 0) return false;
		onBeforeEdit?.();
		onChange(result.timeline);
		for (const id of result.clipIds) copiedIds.add(id);
		selectedIds = result.clipIds;
		selectedClipId = result.clipIds[result.clipIds.length - 1];
		return true;
	}

	function onKeyDown(e: KeyboardEvent) {
		if (isTextEntryTarget(e.target)) return;
		// The media lightbox and other overlays own the keyboard while they're
		// up: Escape and Delete must not reach the clips behind them.
		if (isModalKeyboardOpen()) return;
		if (e.ctrlKey || e.metaKey) {
			const key = e.key.toLowerCase();
			if (key === "c" && copySelection()) {
				e.preventDefault();
				e.stopPropagation();
				return;
			}
			if (key === "v" && pasteClipboard()) {
				e.preventDefault();
				e.stopPropagation();
				return;
			}
			return;
		}
		if (e.key === "Escape" && selectedIds.length > 0) {
			deselect();
			return;
		}
		if (e.key !== "Delete" && e.key !== "Backspace") return;
		if (selectedIds.length === 0) return;
		e.preventDefault();
		deleteSelection();
	}
</script>

<svelte:window onkeydown={onKeyDown} />

<div class="text-tl">
	{#each timeline.lanes as lane (lane.id)}
		<div
			class="tl-row layer-row"
			class:lifted={draggingLaneId === lane.id}
			class:folded={foldedLaneIds.has(lane.id)}
			style="order: {stackAt(lane.id)}"
			data-layer-id={lane.id}
			data-lane-kind="text"
		>
			<div class="tl-gutter">
				<LaneGrip
					{layerOrder}
					laneId={lane.id}
					laneName={lane.name}
					onDragStart={onLaneDragStart}
				/>
				<button
					class="lane-fold"
					class:folded={foldedLaneIds.has(lane.id)}
					title={foldedLaneIds.has(lane.id)
						? "Unfold this lane"
						: "Fold this lane to a strip"}
					aria-expanded={!foldedLaneIds.has(lane.id)}
					onclick={() => onToggleFold?.(lane.id)}
				>
					<ChevronDown size={11} />
				</button>
				<button
					class="lane-eye"
					class:off={!lane.enabled}
					title={lane.enabled ? "Hide this lane" : "Show this lane"}
					onclick={() => setLane(lane.id, "enabled", !lane.enabled)}
				>
					{#if lane.enabled}<Eye size={12} />{:else}<EyeOff size={12} />{/if}
				</button>
				<LaneName
					name={lane.name}
					title="{lane.name} — click to edit this lane's style and effects."
					onclick={() => openLane(lane)}
					onRename={(name) => setLane(lane.id, "name", name)}
				/>
				<button
					class="lane-del"
					title="Delete this lane"
					onclick={() => requestDeleteLane(lane)}
				>
					<Trash2 size={12} />
				</button>
			</div>

			<div
				class="tl-lane lane-track"
				use:laneTrack={lane.id}
				style={foldedLaneIds.has(lane.id)
					? `min-height: ${LANE_FOLDED_HEIGHT}px`
					: `height: ${LANE_HEIGHT}px`}
				role="group"
				aria-label="{lane.name} clips"
				ondblclick={(e) => onTrackDblClick(e, lane.id)}
				onpointerdown={(e) => onLanePointerDown(e, lane.id)}
				onpointermove={onPointerMove}
				onpointerup={onPointerUp}
				onpointercancel={onPointerUp}
			>
				{#each lane.clips as clip (clip.id)}
					{@const left = vp.toPct(clip.start)}
					{@const width = vp.toPct(clip.end) - left}
					{@const edge = edgeWidth(clip)}
					{#if left < 100 && left + width > 0}
						<div
							class="clip"
							class:selected={selectedIds.includes(clip.id)}
							class:primary={selectedIds.length > 1 &&
								clip.id === selectedClipId}
							class:muted={!lane.enabled}
							style="left: {left}%; width: {width}%"
							role="button"
							tabindex="0"
							title={clip.text}
							draggable="false"
							ondragstart={(e) => e.preventDefault()}
							onpointerdown={(e) =>
								onClipPointerDown(e, lane.id, clip.id, "move")}
						>
							<span
								class="clip-edge start"
								style="width: {edge}px"
								role="presentation"
								onpointerdown={(e) =>
									onClipPointerDown(e, lane.id, clip.id, "start")}
							></span>
							{#if clipPx(clip) >= MIN_LABEL_PX}
								<span class="clip-label">{clip.text || "—"}</span>
							{/if}
							<span
								class="clip-edge end"
								style="width: {edge}px"
								role="presentation"
								onpointerdown={(e) =>
									onClipPointerDown(e, lane.id, clip.id, "end")}
							></span>
						</div>
					{/if}
				{/each}

				{#each adjacentPairs(lane) as pair (pair.left.id)}
					{@const left = vp.toPct(pair.at)}
					{#if left >= 0 && left <= 100}
						<div
							class="clip-boundary"
							style="left: {left}%; width: {boundaryWidth(
								pair.left,
								pair.right,
							)}px"
							role="presentation"
							title="Drag to trim both clips"
							onpointerdown={(e) =>
								onBoundaryPointerDown(e, lane.id, pair.left.id, pair.right.id)}
						></div>
					{/if}
				{/each}
			</div>
		</div>
	{/each}

	{#if lanePendingDelete}
		{@const count = lanePendingDelete.clips.length}
		<ConfirmDialog
			title="Delete “{lanePendingDelete.name}”?"
			message="This removes the lane and the {count} text clip{count === 1
				? ''
				: 's'} on it."
			confirmLabel="Delete lane"
			cancelLabel="Cancel"
			danger
			onConfirm={() => deleteLane(lanePendingDelete!.id)}
			onCancel={() => (lanePendingDelete = null)}
		/>
	{/if}

	{#if lyricsSync && lyricsOpen}
		{#await loadLyricsSyncModal() then LyricsSyncModal}
			<LyricsSyncModal
				open={lyricsOpen}
				currentTime={stack.currentTime}
				isPlaying={lyricsSync.isPlaying}
				spanStart={lyricsSync.spanStart}
				spanEnd={lyricsSync.spanEnd}
				getCurrentTime={lyricsSync.getCurrentTime}
				existing={lyricsDraft}
				onPlay={lyricsSync.onPlay}
				onPause={lyricsSync.onPause}
				onSeek={lyricsSync.onSeek}
				onApply={lyricsSync.onApply}
				onClose={() => (lyricsOpen = false)}
			/>
		{/await}
	{/if}
</div>

<style>
	/* No box of its own: the rows join the layer column their sibling component
	   renders into, so one `order` per row interleaves the two kinds. */
	.text-tl {
		display: contents;
	}

	/* The row follows the pointer by re-ordering, not by moving, so this is the
	   only thing that says which one is in hand. */
	.layer-row.lifted {
		opacity: 0.55;
	}

	.lane-eye,
	.lane-del,
	.lane-fold {
		display: inline-flex;
		align-items: center;
		padding: 0.15rem;
		border: none;
		background: none;
		color: var(--text-3);
		cursor: pointer;
	}

	.lane-fold {
		transition:
			color var(--t-fast),
			transform var(--t-fast);
	}

	.lane-fold:hover {
		color: var(--text);
	}

	/* Points right when the lane is folded, down when it is open. */
	.lane-fold.folded {
		transform: rotate(-90deg);
	}

	.lane-eye:hover,
	.lane-del:hover {
		color: var(--text);
	}

	.lane-eye.off {
		color: var(--text-4);
	}

	.lane-track {
		border: 1px solid var(--line);
		border-radius: 4px;
		background: var(--ink);
		overflow: hidden;
		touch-action: none;
	}

	.clip {
		position: absolute;
		top: 3px;
		bottom: 3px;
		display: flex;
		align-items: center;
		border: 1px solid var(--live-dim);
		border-radius: 3px;
		background: #24384d;
		color: #dce8f2;
		font-size: 0.68rem;
		cursor: grab;
		overflow: hidden;
		/* A clip is dragged with pointer events, so the browser's own drag — the
		   translucent copy that trails the cursor — is never wanted. Covers the
		   label and edges too. */
		user-select: none;
		-webkit-user-drag: none;
	}

	.clip.selected {
		border-color: var(--live);
		background: var(--live-dim);
	}

	/* Which of a multi-selection the clip panel is editing. */
	.clip.primary {
		box-shadow: inset 0 0 0 1px var(--live);
	}

	.clip.muted {
		opacity: 0.4;
	}

	.clip-label {
		flex: 1;
		min-width: 0;
		padding: 0 0.4rem;
		white-space: nowrap;
		overflow: hidden;
		text-overflow: ellipsis;
		pointer-events: none;
	}

	/* Width is set inline, against the clip's own width — see edgeWidth. At full
	   size that is EDGE_GRAB, wider than the boundary's half-width, so a flush
	   junction still leaves a strip that trims one clip and opens a gap.
	   Positioned rather than laid out in the flex row: as flex items they
	   competed with the label, whose padding cannot shrink, so on a narrow clip
	   they were pushed into overflow and the end handle was clipped away. */
	.clip-edge {
		position: absolute;
		top: 0;
		bottom: 0;
		cursor: ew-resize;
	}

	.clip-edge.start {
		left: 0;
	}

	.clip-edge.end {
		right: 0;
	}

	.clip-edge:hover {
		background: var(--live);
	}

	.clip-boundary {
		position: absolute;
		top: 0;
		bottom: 0;
		transform: translateX(-50%);
		cursor: ew-resize;
		z-index: 3;
	}

	/* Centred in the grab area, which is wider than the line and sized inline. */
	.clip-boundary::after {
		content: "";
		position: absolute;
		top: 0;
		bottom: 0;
		left: 50%;
		width: 1px;
		transform: translateX(-50%);
		background: rgba(255, 255, 255, 0.3);
	}

	.clip-boundary:hover::after {
		width: 2px;
		background: var(--live);
	}
</style>
