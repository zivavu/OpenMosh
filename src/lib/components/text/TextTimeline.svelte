<script lang="ts">
	import {
		Crosshair,
		Eye,
		EyeOff,
		MicVocal,
		Pause,
		Play,
		Plus,
		Trash2,
	} from 'lucide-svelte';
	import { untrack } from 'svelte';
	import { TimelineViewport } from '../../editor/timeline-viewport.svelte';
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
	import TimelineScrollbar from '../ui/TimelineScrollbar.svelte';
	import ConfirmDialog from '../ui/ConfirmDialog.svelte';

	/** Length a click-to-add clip gets, when the gap it lands in allows it. */
	const DEFAULT_CLIP_LENGTH = 2;
	const LANE_HEIGHT = 30;
	/** Chain position meaning "over the finished frame". */
	const ON_TOP = Number.MAX_SAFE_INTEGER;

	interface Props {
		timeline: TextTimeline;
		trackDuration: number;
		currentTime?: number;
		/** Names of the enabled main effects, in order — the chain-position picker. */
		chainLabels?: string[];
		selectedClipId?: string | null;
		onChange: (timeline: TextTimeline) => void;
		/** Called before a change lands, while the pre-edit state is intact. */
		onBeforeEdit?: (coalesceKey?: string) => void;
		/** Scrubbing the ruler. Omit when the mode has its own transport. */
		onSeek?: (time: number) => void;
		/** Given both, the ruler grows a play button — the only transport a still
		 * image has, since there is no track or video to drive one. */
		isPlaying?: boolean;
		onTogglePlay?: (() => void) | null;
		/** When provided, the header grows a Lyrics button that opens the sync
		 * modal, wired to the mode's own transport. */
		lyricsSync?: LyricsSyncProps | null;
		/** External open/close of the sync modal (e.g. the editor's top bar). */
		lyricsOpen?: boolean;
	}

	let {
		timeline,
		trackDuration,
		currentTime = 0,
		chainLabels = [],
		selectedClipId = $bindable(null),
		onChange,
		onBeforeEdit,
		onSeek,
		isPlaying = false,
		onTogglePlay = null,
		lyricsSync = null,
		lyricsOpen = $bindable(false),
	}: Props = $props();

	/** What the sync modal opens onto: the lyrics lane as the timeline holds it,
	 * so clips dragged here show up there with their nudged times. */
	let lyricsDraft = $derived(lyricsDraftFromTimeline(timeline));

	let trackEl = $state<HTMLElement | undefined>(undefined);
	/** Whether the view chases the playhead. Panning the view by hand takes it
	 * over — chasing while the user is reading somewhere else just drags them
	 * back — and pressing play (or the Follow button) hands it back. */
	let followPlayhead = $state(true);
	const vp = new TimelineViewport(
		() => trackDuration,
		() => trackEl?.getBoundingClientRect() ?? null,
		// Wheel-zoom pins the playhead when it's on screen, but only while
		// following; a hand-panned view zooms around the cursor instead.
		() => (followPlayhead ? currentTime : null),
	);

	/** Every lane track shares one geometry, so any of them can measure the
	 * viewport — and scrolling over any of them should zoom all of them. */
	function laneTrack(node: HTMLElement) {
		trackEl = node;
		const detachWheel = vp.attachWheel(node, () => (followPlayhead = false));
		return {
			destroy() {
				detachWheel();
				if (trackEl === node) trackEl = undefined;
			},
		};
	}

	// Follow the track: any new duration opens the window onto the whole thing.
	// The duration grows under us — both modes start on the short record window
	// and only reach the track length once a track loads — and the old window
	// left in place reads as a deep zoom into the new, far longer timeline.
	let viewedDuration = 0;
	$effect(() => {
		const d = trackDuration;
		if (d <= 0 || d === viewedDuration) return;
		viewedDuration = d;
		vp.viewStart = 0;
		vp.viewEnd = d;
		followPlayhead = true;
	});

	// Pressing play hands the view back to the playhead: starting playback is
	// the moment the user wants to watch it again.
	let wasPlaying = false;
	$effect(() => {
		const playing = isPlaying;
		untrack(() => {
			if (playing && !wasPlaying) followPlayhead = true;
			wasPlaying = playing;
		});
	});

	// Keep the playhead centred: the view slides under it rather than the other
	// way round, so the clip being heard is always the one in the middle. Only
	// while zoomed — unzoomed the whole track is on screen and there is nothing
	// to scroll. panView clamps at the track ends, where the window runs out of
	// room and the playhead drifts off centre instead of scrolling past the end.
	$effect(() => {
		const t = currentTime;
		const d = trackDuration;
		if (d <= 0 || !followPlayhead) return;
		// Untracked, pan included: panView reads the window it writes, so a
		// tracked call retriggers on its own pan — and at the track ends, where
		// the clamp means the correction never reaches zero, never settles.
		untrack(() => {
			if (!vp.isZoomed || vp.viewEnd <= 0) return;
			const centred = t - (vp.viewStart + vp.viewDuration / 2);
			if (centred !== 0) vp.panView(centred);
		});
	});

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

	function addLane() {
		onBeforeEdit?.();
		onChange({
			...timeline,
			lanes: [
				...timeline.lanes,
				createTextLane(`Text ${timeline.lanes.length + 1}`),
			],
		});
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
	 * Sized against the clip rather than fixed. At a flat 10px each, two handles
	 * overrun any clip under 20px wide and the right one is clipped away
	 * entirely — text set very small does exactly that. A third each keeps both
	 * edges grabbable at any width, and leaves the middle third to drag by.
	 */
	function edgeWidth(clip: TextClip): number {
		const px = trackEl?.getBoundingClientRect().width ?? 0;
		if (px <= 0) return EDGE_GRAB;
		const clipPx = ((clip.end - clip.start) / vp.viewDuration) * px;
		return Math.max(1, Math.min(EDGE_GRAB, clipPx / 3));
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

	function onPointerMove(e: PointerEvent) {
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
		if (!drag) return;
		drag = null;
		(e.currentTarget as HTMLElement).releasePointerCapture?.(e.pointerId);
	}

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

	let scrubbing = $state(false);

	function onRulerPointerDown(e: PointerEvent) {
		if (e.button !== 0 || !onSeek || trackDuration <= 0) return;
		scrubbing = true;
		(e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
		onSeek(vp.clientXToTime(e.clientX));
	}

	function onRulerPointerMove(e: PointerEvent) {
		if (!scrubbing || !onSeek) return;
		onSeek(vp.clientXToTime(e.clientX));
	}

	function onRulerPointerUp(e: PointerEvent) {
		if (!scrubbing) return;
		scrubbing = false;
		(e.currentTarget as HTMLElement).releasePointerCapture?.(e.pointerId);
	}

	let playheadPct = $derived(vp.toPct(currentTime));

</script>

<svelte:window onkeydown={onKeyDown} />

<div class="text-tl">
	<div class="tl-head">
		<span class="tl-title">Text</span>
		<button class="tl-btn" onclick={addLane} title="Add a text lane">
			<Plus size={12} /> Lane
		</button>
		{#if lyricsSync}
			<button
				class="tl-btn"
				class:active={lyricsOpen}
				onclick={() => (lyricsOpen = true)}
				title="Sync lyrics to the song: paste them, then press Space as it plays"
			>
				<MicVocal size={12} /> Lyrics
			</button>
		{/if}
		{#if trackDuration > 0}
			<button
				class="tl-btn"
				class:active={followPlayhead}
				onclick={() => (followPlayhead = !followPlayhead)}
				title={followPlayhead
					? 'Following the playhead — scroll or drag the scrollbar to look elsewhere'
					: 'Follow the playhead again'}
			>
				<Crosshair size={12} /> Follow
			</button>
		{/if}
		{#if trackDuration <= 0}
			<span class="tl-hint">No timeline yet — add media or a track.</span>
		{/if}
	</div>

	{#if trackDuration > 0}
		<div class="lane-row">
			<div class="lane-head ruler-head">
				{#if onTogglePlay}
					<button
						class="lane-eye"
						title={isPlaying ? 'Pause' : 'Play'}
						onclick={onTogglePlay}
					>
						{#if isPlaying}<Pause size={12} />{:else}<Play size={12} />{/if}
					</button>
				{/if}
				<span class="ruler-time">{currentTime.toFixed(2)}s</span>
			</div>
			<div
				class="ruler"
				class:seekable={!!onSeek}
				use:laneTrack
				role="slider"
				tabindex="-1"
				aria-label="Text timeline playhead"
				aria-valuemin={0}
				aria-valuemax={trackDuration}
				aria-valuenow={currentTime}
				onpointerdown={onRulerPointerDown}
				onpointermove={onRulerPointerMove}
				onpointerup={onRulerPointerUp}
				onpointercancel={onRulerPointerUp}
			>
				{#if playheadPct >= 0 && playheadPct <= 100}
					<div class="playhead" style="left: {playheadPct}%"></div>
				{/if}
			</div>
		</div>
	{/if}

	{#each timeline.lanes as lane (lane.id)}
		<div class="lane-row">
			<div class="lane-head">
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
				class="lane-track"
				use:laneTrack
				style="height: {LANE_HEIGHT}px"
				role="group"
				aria-label="{lane.name} clips"
				ondblclick={(e) => onTrackDblClick(e, lane.id)}
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
							<span class="clip-label">{clip.text || '—'}</span>
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

				{#if trackDuration > 0 && playheadPct >= 0 && playheadPct <= 100}
					<div class="playhead" style="left: {playheadPct}%"></div>
				{/if}
			</div>
		</div>
	{/each}

	{#if trackDuration > 0}
		<div class="lane-row">
			<div class="lane-head"></div>
			<TimelineScrollbar
				{vp}
				{trackDuration}
				onPanStart={() => (followPlayhead = false)}
			/>
		</div>
	{/if}

	{#if timeline.lanes.length === 0}
		<p class="tl-empty">No text lanes. Add one to put text on the timeline.</p>
	{/if}

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
			currentTime={currentTime}
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
		padding: 0.4rem 0.5rem;
		border-top: 1px solid #2a2a2a;
	}

	.tl-head {
		display: flex;
		align-items: center;
		gap: 0.5rem;
	}

	.tl-title {
		font-size: 0.7rem;
		font-weight: 600;
		letter-spacing: 0.08em;
		color: #888;
		text-transform: uppercase;
	}

	.tl-btn {
		display: inline-flex;
		align-items: center;
		gap: 0.2rem;
		padding: 0.15rem 0.4rem;
		border: 1px solid #333;
		border-radius: 4px;
		background: #1a1a1a;
		color: #ccc;
		font-size: 0.7rem;
		cursor: pointer;
	}

	.tl-btn:hover {
		border-color: #555;
		color: #fff;
	}

	.tl-btn.active {
		border-color: #4a6a8a;
		color: #fff;
	}

	.tl-hint,
	.tl-empty {
		color: #666;
		font-size: 0.68rem;
	}

	.lane-row {
		display: flex;
		align-items: stretch;
		gap: 0.35rem;
	}

	.lane-head {
		display: flex;
		align-items: center;
		gap: 0.2rem;
		width: 150px;
		flex-shrink: 0;
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

	.lane-chain {
		flex: 1;
		min-width: 0;
		padding: 0.1rem 0.2rem;
		border: 1px solid #333;
		border-radius: 4px;
		background: #1a1a1a;
		color: #bbb;
		font-size: 0.68rem;
		font-family: inherit;
	}

	.ruler {
		position: relative;
		flex: 1;
		height: 14px;
		border: 1px solid #2a2a2a;
		border-radius: 3px;
		background: #101010;
		touch-action: none;
	}

	.ruler.seekable {
		cursor: pointer;
	}

	.ruler-head {
		justify-content: flex-end;
	}

	.ruler-time {
		color: #777;
		font-size: 0.65rem;
		font-variant-numeric: tabular-nums;
	}

	.lane-track {
		position: relative;
		flex: 1;
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

	.playhead {
		position: absolute;
		top: 0;
		bottom: 0;
		width: 1px;
		background: #e05a5a;
		pointer-events: none;
	}
</style>
