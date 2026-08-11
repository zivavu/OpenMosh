<script lang="ts">
	import { Eye, EyeOff, Trash2 } from 'lucide-svelte';
	import { untrack } from 'svelte';
	import { getTimelineStack } from '../../editor/timeline-stack.svelte';
	import { isTextEntryTarget } from '../../editor/shortcut-target';
	import {
		addClip,
		clipRange,
		createTextClip,
		createTextLane,
		freeRangeAt,
		lyricsDraftFromTimeline,
		MIN_CLIP_LENGTH,
		moveClip,
		moveClips,
		removeClip,
		resizeBoundary,
		resizeClip,
		sortClips,
		updateLane,
		type TextClip,
		type TextLane,
		type TextTimeline,
	} from '../../text';
	import LyricsSyncModal, {
		type LyricsSyncProps,
	} from './LyricsSyncModal.svelte';
	import ConfirmDialog from '../ui/ConfirmDialog.svelte';

	/** Length a click-to-add clip gets, when the gap it lands in allows it. */
	const DEFAULT_CLIP_LENGTH = 2;
	const LANE_HEIGHT = 30;
	/** Chain position meaning "over the finished frame". */
	const ON_TOP = Number.MAX_SAFE_INTEGER;

	interface Props {
		timeline: TextTimeline;
		/** Names of the enabled main effects, in order — the chain-position picker. */
		chainLabels?: string[];
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
		chainLabels = [],
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
	 * it — every lane shares one geometry, so whichever mounted last will do. */
	function laneTrack(node: HTMLElement) {
		trackEl = node;
		const shared = stack.lane(node);
		return {
			destroy() {
				shared.destroy();
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
	/** Set on pointerdown when a plain click landed on an already-selected clip:
	 * the selection has to survive until pointerup so the group can be dragged,
	 * and only collapses if the click turns out not to be a drag. */
	let collapseOnUp: string | null = null;

	function selectOnly(clipId: string) {
		selectedClipId = clipId;
		selectedIds = [clipId];
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

	/** Clips are placed freely — no grid, nothing to snap to. */
	function timeAt(clientX: number): number {
		return vp.clientXToTime(clientX);
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

	function addClipAt(laneId: string, time: number) {
		const lane = laneOf(laneId);
		if (!lane) return;
		const gap = freeRangeAt(lane, time, trackDuration);
		if (!gap) return;
		const start = Math.max(gap.start, Math.min(time, gap.end - MIN_CLIP_LENGTH));
		const end = Math.min(start + DEFAULT_CLIP_LENGTH, gap.end);
		const clip = createTextClip(start, end, 'TEXT');
		onBeforeEdit?.();
		onChange(updateLane(timeline, laneId, (l) => addClip(l, clip, trackDuration)));
		selectOnly(clip.id);
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
		collapseOnUp = null;

		// Shift extends from the primary, ctrl/cmd toggles one. Neither starts a
		// drag — they are selection gestures, and dragging from them would move
		// clips the user was only trying to pick.
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
		if ((e.ctrlKey || e.metaKey) && mode === 'move') {
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

		// A plain click on part of the selection keeps it, so the group can be
		// dragged; it collapses on pointerup if nothing moved.
		if (selectedIds.length > 1 && selectedIds.includes(clipId)) {
			selectedClipId = clipId;
			collapseOnUp = clipId;
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
			mode: 'boundary',
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

	/** Empty lane space scrubs: with no ruler row of its own, every lane has to
	 * be draggable, or a text-only timeline has nothing to seek with. */
	function onLanePointerDown(e: PointerEvent) {
		if (e.button !== 0 || trackDuration <= 0) return;
		if ((e.target as HTMLElement | null)?.closest?.('.clip')) return;
		scrubbing = true;
		(e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
		stack.seekTo(timeAt(e.clientX));
	}

	function onPointerMove(e: PointerEvent) {
		if (scrubbing) stack.seekTo(timeAt(e.clientX));
		if (!drag) return;
		const t = timeAt(e.clientX);
		const { laneId, clipId, otherId, mode, grabOffset } = drag;
		collapseOnUp = null;
		onChange(
			updateLane(timeline, laneId, (lane) => {
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
		if (collapseOnUp) {
			selectOnly(collapseOnUp);
			collapseOnUp = null;
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
		selectedClipId = null;
		selectedIds = [];
	}

	function onKeyDown(e: KeyboardEvent) {
		if (isTextEntryTarget(e.target)) return;
		if (e.key === 'Escape' && selectedIds.length > 0) {
			selectedClipId = null;
			return;
		}
		if (e.key !== 'Delete' && e.key !== 'Backspace') return;
		if (selectedIds.length === 0) return;
		e.preventDefault();
		deleteSelection();
	}

</script>

<svelte:window onkeydown={onKeyDown} />

<div class="text-tl">
	{#each timeline.lanes as lane (lane.id)}
		<div class="tl-row">
			<div class="tl-gutter">
				<button
					class="lane-eye"
					class:off={!lane.enabled}
					title={lane.enabled ? 'Hide this lane' : 'Show this lane'}
					onclick={() => setLane(lane.id, 'enabled', !lane.enabled)}
				>
					{#if lane.enabled}<Eye size={12} />{:else}<EyeOff size={12} />{/if}
				</button>
				<select
					class="lane-chain"
					title="Where this text meets the effect chain"
					value={lane.chainIndex >= chainLabels.length ? ON_TOP : lane.chainIndex}
					onchange={(e) =>
						setLane(
							lane.id,
							'chainIndex',
							+(e.currentTarget as HTMLSelectElement).value,
						)}
				>
					<option value={ON_TOP}>On top</option>
					{#each chainLabels as label, i (i)}
						<option value={i}>From “{label}”</option>
					{/each}
				</select>
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
				use:laneTrack
				style="height: {LANE_HEIGHT}px"
				role="group"
				aria-label="{lane.name} clips"
				ondblclick={(e) => onTrackDblClick(e, lane.id)}
				onpointerdown={onLanePointerDown}
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
								onClipPointerDown(e, lane.id, clip.id, 'move')}
						>
							<span
								class="clip-edge start"
								style="width: {edge}px"
								role="presentation"
								onpointerdown={(e) =>
									onClipPointerDown(e, lane.id, clip.id, 'start')}
							></span>
							{#if clipPx(clip) >= MIN_LABEL_PX}
								<span class="clip-label">{clip.text || '—'}</span>
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

	{#if lyricsSync}
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
	{/if}
</div>

<style>
	.text-tl {
		display: flex;
		flex-direction: column;
		gap: 2px;
	}

	.lane-eye,
	.lane-del {
		display: inline-flex;
		align-items: center;
		padding: 0.15rem;
		border: none;
		background: none;
		color: #888;
		cursor: pointer;
	}

	.lane-eye:hover,
	.lane-del:hover {
		color: #fff;
	}

	.lane-eye.off {
		color: #555;
	}

	/* Borderless until hovered: three framed controls per lane gutter read as
	   more chrome than the lane itself. */
	.lane-chain {
		flex: 1;
		min-width: 0;
		padding: 0.1rem 0.15rem;
		border: 1px solid transparent;
		border-radius: 4px;
		background: none;
		color: #8a8a8a;
		font-size: 0.65rem;
		font-family: inherit;
	}

	.lane-chain:hover,
	.lane-chain:focus {
		border-color: #333;
		background: #1a1a1a;
		color: #ddd;
	}

	.lane-track {
		border: 1px solid #2a2a2a;
		border-radius: 4px;
		background: #141414;
		overflow: hidden;
		touch-action: none;
	}

	.clip {
		position: absolute;
		top: 3px;
		bottom: 3px;
		display: flex;
		align-items: center;
		border: 1px solid #3a5a7a;
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
		border-color: #7ab8f5;
		background: #2f527a;
	}

	/* Which of a multi-selection the clip panel is editing. */
	.clip.primary {
		box-shadow: inset 0 0 0 1px #cfe6ff;
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
		background: #7ab8f5;
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
		background: #7ab8f5;
	}

</style>
