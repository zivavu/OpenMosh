<script lang="ts">
	import { Eye, EyeOff, Image as ImageIcon, Trash2 } from 'lucide-svelte';
	import { untrack } from 'svelte';
	import { dropAutoRangeScope } from '../../audio/auto-range';
	import { getTimelineStack } from '../../editor/timeline-stack.svelte';
	import { isTextEntryTarget } from '../../editor/shortcut-target';
	import {
		addClip,
		clipRange,
		copyMediaClips,
		createMediaClip,
		freeRangeAt,
		MIN_CLIP_LENGTH,
		moveClip,
		moveClips,
		pasteMediaClips,
		removeClip,
		resizeBoundary,
		resizeClip,
		sortClips,
		splitMediaClipAt,
		updateMediaLane,
		type MediaClip,
		type MediaClipboardEntry,
		type MediaLane,
		type MediaTimeline,
	} from '../../media';
	import type { SequenceSource } from '../../editor/sequence-sources.svelte';
	import { SOURCE_DND_TYPE } from '../../editor/sequence-source-ui';
	import { stackIndex, type LayerRef } from '../../timeline/layer-order';
	import LaneGrip from '../ui/LaneGrip.svelte';
	import ConfirmDialog from '../ui/ConfirmDialog.svelte';

	/** Length a click-to-add clip gets, when the gap it lands in allows it. */
	const DEFAULT_CLIP_LENGTH = 2;
	const LANE_HEIGHT = 30;

	interface Props {
		timeline: MediaTimeline;
		/** Every layer, front first — this lane's place in the stack. */
		layerOrder?: LayerRef[];
		/** Starts a row drag that reorders the whole layer stack. The editor owns
		 * it: a drag crosses into the other kind's rows, which this can't see. */
		onLaneDragStart?: (laneId: string, e: PointerEvent) => void;
		/** Id of the row being dragged right now, for its lifted look. */
		draggingLaneId?: string | null;
		/** The media pool, for naming and thumbnailing each lane's source. */
		sources?: SequenceSource[];
		selectedClipId?: string | null;
		onChange: (timeline: MediaTimeline) => void;
		/** Called before a change lands, while the pre-edit state is intact. */
		onBeforeEdit?: (coalesceKey?: string) => void;
	}

	let {
		timeline,
		layerOrder = [],
		onLaneDragStart,
		draggingLaneId = null,
		sources = [],
		selectedClipId = $bindable(null),
		onChange,
		onBeforeEdit,
	}: Props = $props();

	// ── Source drops ─────────────────────────────────────────────────────────
	// The same payload the media rail and the sequence grid send, so a thumb
	// dragged onto a lane sets what that layer draws.
	let dropLaneId = $state<string | null>(null);

	function isSourceDrag(e: DragEvent): boolean {
		return !!e.dataTransfer?.types.includes(SOURCE_DND_TYPE);
	}

	function onLaneDragOver(e: DragEvent, laneId: string) {
		if (!isSourceDrag(e)) return;
		// Without preventDefault the browser refuses the drop entirely.
		e.preventDefault();
		if (e.dataTransfer) e.dataTransfer.dropEffect = 'copy';
		dropLaneId = laneId;
	}

	function onLaneDragLeave(e: DragEvent) {
		// Ignore the leaves fired crossing between a row's own children.
		if (
			e.currentTarget instanceof Element &&
			e.relatedTarget instanceof Node &&
			e.currentTarget.contains(e.relatedTarget)
		) {
			return;
		}
		dropLaneId = null;
	}

	function onLaneDrop(e: DragEvent, laneId: string) {
		if (!isSourceDrag(e)) return;
		e.preventDefault();
		const sourceId = e.dataTransfer?.getData(SOURCE_DND_TYPE) ?? '';
		dropLaneId = null;
		if (!sourceId) return;
		const lane = laneOf(laneId);
		if (!lane || lane.sourceId === sourceId) return;
		onBeforeEdit?.();
		onChange(updateMediaLane(timeline, laneId, (l) => ({ ...l, sourceId })));
	}

	function sourceOf(lane: MediaLane): SequenceSource | undefined {
		return sources.find((s) => s.id === lane.sourceId);
	}

	/** What a clip says it is showing. Lanes with no source read as unset. */
	function laneLabel(lane: MediaLane): string {
		return sourceOf(lane)?.name ?? 'No source';
	}

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
		const unregister = stack.registerSplitter(laneId, (t) => splitAt(laneId, t));
		return {
			destroy() {
				shared.destroy();
				unregister();
				if (trackEl === node) trackEl = undefined;
			},
		};
	}

	let drag = $state<{
		laneId: string;
		clipId: string;
		/** The clip on the far side of a shared-boundary drag. */
		otherId?: string;
		mode: 'move' | 'start' | 'end' | 'boundary';
		/** Seconds between the pointer and the clip's start, for move drags. */
		grabOffset: number;
	} | null>(null);

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

	// Follow external changes to the primary (the panel's back button), and drop
	// ids whose clips are gone.
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

	/** Clips are placed freely — no grid, nothing to snap to. */
	function timeAt(clientX: number): number {
		return vp.clientXToTime(clientX);
	}

	/** This lane's place in the stack that spans both kinds of layer. */
	function stackAt(laneId: string): number {
		return stackIndex(layerOrder, laneId);
	}

	function laneOf(laneId: string): MediaLane | undefined {
		return timeline.lanes.find((l) => l.id === laneId);
	}

	/** Lane the delete button is asking about; null when nothing is pending. */
	let lanePendingDelete = $state<MediaLane | null>(null);

	/** An empty lane takes nothing with it, so it goes without asking. */
	function requestDeleteLane(lane: MediaLane) {
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

	function setLane<K extends keyof MediaLane>(
		laneId: string,
		key: K,
		value: MediaLane[K],
	) {
		onBeforeEdit?.();
		onChange(updateMediaLane(timeline, laneId, (l) => ({ ...l, [key]: value })));
	}

	/**
	 * Put the panel on this lane. A lane whose clips were all deleted has nothing
	 * to select and no other way back, so it gets a full-length one first —
	 * which is also the only state where a layer is invisible with no way to say
	 * where it should be.
	 */
	function openLane(lane: MediaLane) {
		const first = sortClips(lane.clips)[0];
		if (first) {
			selectOnly(first.id);
			return;
		}
		if (trackDuration <= 0) return;
		const clip = createMediaClip(0, trackDuration);
		onBeforeEdit?.();
		onChange(
			updateMediaLane(timeline, lane.id, (l) => addClip(l, clip, trackDuration)),
		);
		selectOnly(clip.id);
	}

	function addClipAt(laneId: string, time: number) {
		const lane = laneOf(laneId);
		if (!lane) return;
		const gap = freeRangeAt(lane, time, trackDuration);
		if (!gap) return;
		const start = Math.max(gap.start, Math.min(time, gap.end - MIN_CLIP_LENGTH));
		const end = Math.min(start + DEFAULT_CLIP_LENGTH, gap.end);
		const clip = createMediaClip(start, end);
		onBeforeEdit?.();
		onChange(updateMediaLane(timeline, laneId, (l) => addClip(l, clip, trackDuration)));
		selectOnly(clip.id);
	}

	/** Cut the clip under `time` on one lane in two — the S shortcut's target. */
	function splitAt(laneId: string, time: number) {
		const lane = laneOf(laneId);
		if (!lane) return;
		const next = splitMediaClipAt(lane, time);
		// Not inside a clip, or one half would be too short to keep.
		if (next === lane) return;
		onBeforeEdit?.();
		onChange(updateMediaLane(timeline, laneId, () => next));
		deselect();
	}

	function deleteClip(laneId: string, clipId: string) {
		onBeforeEdit?.();
		onChange(updateMediaLane(timeline, laneId, (l) => removeClip(l, clipId)));
		if (selectedClipId === clipId) selectedClipId = null;
	}

	function onTrackDblClick(e: MouseEvent, laneId: string) {
		if (trackDuration <= 0) return;
		// A double-click inside a clip is the clip's business; only empty lane
		// space drops a new clip.
		if ((e.target as HTMLElement | null)?.closest?.('.clip')) return;
		addClipAt(laneId, timeAt(e.clientX));
	}

	function onClipPointerDown(
		e: PointerEvent,
		laneId: string,
		clipId: string,
		mode: 'move' | 'start' | 'end',
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
		if ((e.ctrlKey || e.metaKey) && e.shiftKey && mode === 'move') {
			if (selectedIds.includes(clipId)) {
				const rest = selectedIds.filter((x) => x !== clipId);
				selectedIds = rest;
				if (selectedClipId === clipId) selectedClipId = rest[rest.length - 1] ?? null;
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
		if (e.shiftKey && mode === 'move') {
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
		if (selectedIds.includes(clipId) && mode === 'move') {
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
		onBeforeEdit?.(`media-${mode}-${clipId}`);
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
			mode: 'boundary',
			grabOffset: 0,
		};
		// One undo entry per gesture, not per pointermove.
		onBeforeEdit?.(`media-boundary-${leftId}`);
		(e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
	}

	/** Comfortable grab width for a shared boundary, in px. */
	const BOUNDARY_GRAB = 12;
	/** Comfortable grab width for a clip's own start/end handles, in px. */
	const EDGE_GRAB = 10;
	/**
	 * Below this the label is all ellipsis and no word. The clip's tooltip still
	 * names its source, and the thumbnail strip still reads at any width.
	 */
	const MIN_LABEL_PX = 44;

	/**
	 * Sized against the clip rather than fixed. At a flat 10px each, two handles
	 * overrun any clip under 20px wide and the right one is clipped away
	 * entirely — text set very small does exactly that. A third each keeps both
	 * edges grabbable at any width, and leaves the middle third to drag by.
	 */
	function edgeWidth(clip: MediaClip): number {
		const px = clipPx(clip);
		if (px <= 0) return EDGE_GRAB;
		return Math.max(1, Math.min(EDGE_GRAB, px / 3));
	}

	/** The clip's on-screen width. */
	function clipPx(clip: MediaClip): number {
		const px = trackEl?.getBoundingClientRect().width ?? 0;
		if (px <= 0) return 0;
		return ((clip.end - clip.start) / vp.viewDuration) * px;
	}

	/**
	 * A boundary is drawn over the clips either side of it, so a fixed grab area
	 * would blanket short clips entirely and leave nothing to click. Never take
	 * more than a third of the narrower neighbour.
	 */
	function boundaryWidth(left: MediaClip, right: MediaClip): number {
		const px = trackEl?.getBoundingClientRect().width ?? 0;
		if (px <= 0) return BOUNDARY_GRAB;
		const narrower = Math.min(left.end - left.start, right.end - right.start);
		const narrowerPx = (narrower / vp.viewDuration) * px;
		return Math.max(2, Math.min(BOUNDARY_GRAB, narrowerPx / 3));
	}

	/** Consecutive clip pairs sharing an exact edge — the draggable boundaries. */
	function adjacentPairs(
		lane: MediaLane,
	): { left: MediaClip; right: MediaClip; at: number }[] {
		const clips = sortClips(lane.clips);
		const pairs: { left: MediaClip; right: MediaClip; at: number }[] = [];
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
		if ((e.target as HTMLElement | null)?.closest?.('.clip')) return;
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
		const { laneId, clipId, otherId, mode, grabOffset } = drag;
		clickOnUp = null;
		onChange(
			updateMediaLane(timeline, laneId, (lane) => {
				if (mode === 'move') {
					// Dragging any member drags the whole selection with it. Measured
					// as a delta off the grabbed clip's live position, since each move
					// re-enters here against an already-shifted timeline.
					if (selectedIds.length > 1 && selectedIds.includes(clipId)) {
						const held = lane.clips.find((c) => c.id === clipId);
						if (held) {
							return moveClips(
								lane,
								selectedIds,
								t - grabOffset - held.start,
								trackDuration,
							);
						}
					}
					return moveClip(lane, clipId, t - grabOffset, trackDuration);
				}
				// A boundary drag moves both clips' facing edges; the per-clip edges
				// (resizeClip) trim one clip and can pull it away from its neighbour.
				if (mode === 'boundary') {
					return resizeBoundary(lane, clipId, otherId!, t);
				}
				return resizeClip(lane, clipId, mode, t, trackDuration);
			}),
		);
	}

	function onPointerUp(e: PointerEvent) {
		if (clickOnUp) {
			// Clicking the one selected clip again drops the selection — the same
			// gesture the sequence timeline gives a segment.
			const sole = selectedIds.length === 1 && selectedIds[0] === clickOnUp;
			if (sole) deselect();
			else selectOnly(clickOnUp);
			clickOnUp = null;
		}
		scrubbing = false;
		if (!drag) return;
		drag = null;
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
	// Local to the lanes, like the segment clipboard is to the source lane. The
	// selections are mutually exclusive, so a Ctrl+C with clips selected can only
	// mean these.
	let clipboard = $state<MediaClipboardEntry[]>([]);

	function copySelection(): boolean {
		if (selectedIds.length === 0) return false;
		clipboard = copyMediaClips(timeline, selectedIds);
		return clipboard.length > 0;
	}

	/** Paste at the playhead, and leave the copies selected to drag from there. */
	function pasteClipboard(): boolean {
		if (clipboard.length === 0) return false;
		const result = pasteMediaClips(
			timeline,
			clipboard,
			stack.staticTime,
			trackDuration,
		);
		if (result.clipIds.length === 0) return false;
		onBeforeEdit?.();
		onChange(result.timeline);
		selectedIds = result.clipIds;
		selectedClipId = result.clipIds[result.clipIds.length - 1];
		return true;
	}

	function onKeyDown(e: KeyboardEvent) {
		if (isTextEntryTarget(e.target)) return;
		if (e.ctrlKey || e.metaKey) {
			const key = e.key.toLowerCase();
			if (key === 'c' && copySelection()) {
				e.preventDefault();
				return;
			}
			if (key === 'v' && pasteClipboard()) {
				e.preventDefault();
				return;
			}
			return;
		}
		if (e.key === 'Escape' && selectedIds.length > 0) {
			deselect();
			return;
		}
		if (e.key !== 'Delete' && e.key !== 'Backspace') return;
		if (selectedIds.length === 0) return;
		e.preventDefault();
		deleteSelection();
	}

</script>

<svelte:window onkeydown={onKeyDown} />

<div class="media-tl">
	{#each timeline.lanes as lane (lane.id)}
		<!-- svelte-ignore a11y_no_static_element_interactions -->
		<div
			class="tl-row layer-row"
			class:lifted={draggingLaneId === lane.id}
			class:drop-target={dropLaneId === lane.id}
			style="order: {stackAt(lane.id)}"
			data-layer-id={lane.id}
			ondragover={(e) => onLaneDragOver(e, lane.id)}
			ondragleave={onLaneDragLeave}
			ondrop={(e) => onLaneDrop(e, lane.id)}
		>
			<div class="tl-gutter">
				<LaneGrip
					{layerOrder}
					laneId={lane.id}
					laneName={lane.name}
					onDragStart={onLaneDragStart}
				/>
				<button
					class="lane-eye"
					class:off={!lane.enabled}
					title={lane.enabled ? 'Hide this lane' : 'Show this lane'}
					onclick={() => setLane(lane.id, 'enabled', !lane.enabled)}
				>
					{#if lane.enabled}<Eye size={12} />{:else}<EyeOff size={12} />{/if}
				</button>
				<button
					class="lane-src"
					class:unset={!lane.sourceId}
					title={lane.sourceId
						? `${laneLabel(lane)} — click to edit this layer`
						: 'No source — drag one here from the media rail'}
					onclick={() => openLane(lane)}
				>
					{#if sourceOf(lane)?.thumbUrl}
						<img src={sourceOf(lane)!.thumbUrl} alt="" />
					{:else}
						<ImageIcon size={11} />
					{/if}
				</button>
				<span class="lane-name" title={lane.name}>{lane.name}</span>
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
				style="height: {LANE_HEIGHT}px"
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
							title="{laneLabel(lane)} — double-click to edit"
							ondblclick={() => openLane(lane)}
							draggable="false"
							ondragstart={(e) => e.preventDefault()}
							onpointerdown={(e) =>
								onClipPointerDown(e, lane.id, clip.id, 'move')}
						>
							<span
								class="clip-edge start"
								style="width: {edge}px"
								role="presentation"
								onpointerdown={(e) =>
									onClipPointerDown(e, lane.id, clip.id, 'start')}
							></span>
							{#if sourceOf(lane)?.thumbUrl}
								<span
									class="clip-thumb"
									style="background-image: url({sourceOf(lane)!.thumbUrl})"
								></span>
							{/if}
							{#if clipPx(clip) >= MIN_LABEL_PX}
								<span class="clip-label">{laneLabel(lane)}</span>
							{/if}
							<span
								class="clip-edge end"
								style="width: {edge}px"
								role="presentation"
								onpointerdown={(e) =>
									onClipPointerDown(e, lane.id, clip.id, 'end')}
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
			message="This removes the layer and the {count} clip{count === 1
				? ''
				: 's'} on it."
			confirmLabel="Delete lane"
			cancelLabel="Cancel"
			danger
			onConfirm={() => deleteLane(lanePendingDelete!.id)}
			onCancel={() => (lanePendingDelete = null)}
		/>
	{/if}

</div>

<style>
	/* No box of its own: the rows join the layer column their sibling component
	   renders into, so one `order` per row interleaves the two kinds. */
	.media-tl {
		display: contents;
	}

	.lane-src {
		display: inline-flex;
		align-items: center;
		justify-content: center;
		width: 18px;
		height: 18px;
		flex-shrink: 0;
		padding: 0;
		border: 1px solid var(--line);
		border-radius: 3px;
		background: var(--ink);
		color: var(--text-3);
		cursor: pointer;
		overflow: hidden;
	}

	.lane-src img {
		width: 100%;
		height: 100%;
		object-fit: cover;
	}

	.lane-src:hover {
		border-color: var(--live);
		color: var(--text);
	}

	/* A layer with nothing to draw is the one state worth pointing at. */
	.lane-src.unset {
		border-style: dashed;
		border-color: var(--live-dim);
		color: var(--live);
	}

	.lane-name {
		flex: 1;
		min-width: 0;
		font-size: 0.65rem;
		color: var(--text-3);
		white-space: nowrap;
		overflow: hidden;
		text-overflow: ellipsis;
	}

	/* The row follows the pointer by re-ordering, not by moving, so this is the
	   only thing that says which one is in hand. */
	.layer-row.lifted {
		opacity: 0.55;
	}

	/* A source is being dragged over this row and would land on it. */
	.layer-row.drop-target .lane-track {
		border-color: var(--live);
		box-shadow: inset 0 0 0 1px var(--live);
	}

	.lane-eye,
	.lane-del {
		display: inline-flex;
		align-items: center;
		padding: 0.15rem;
		border: none;
		background: none;
		color: var(--text-3);
		cursor: pointer;
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

	/* The source's thumbnail, tiled along the clip: a filmstrip reads as "this
	   media" faster than the file name does, and survives being zoomed out to a
	   few pixels wide, which the label does not. */
	.clip-thumb {
		position: absolute;
		inset: 0;
		background-size: auto 100%;
		background-repeat: repeat-x;
		opacity: 0.35;
		pointer-events: none;
	}

	.clip-label {
		position: relative;
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
		content: '';
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
