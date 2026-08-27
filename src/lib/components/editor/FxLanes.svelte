<script lang="ts">
	import { Dices, Eraser, Eye, EyeOff, Trash2 } from 'lucide-svelte';
	import { stackIndex, type LayerRef } from '../../timeline/layer-order';
	import LaneGrip from '../ui/LaneGrip.svelte';
	import { dropAutoRangeScope } from '../../audio/auto-range';
	import { untrack } from 'svelte';
	import {
		createFxClip,
		splitFxClipAt,
		type FxClip,
		type FxLane,
	} from '../../editor/fx-lanes';
	import {
		BEAT_INTERVALS,
		intervalLabel,
		type SequenceSegmentMode,
	} from '../../editor/sequence';
	import { isTextEntryTarget } from '../../editor/shortcut-target';
	import { getTimelineStack } from '../../editor/timeline-stack.svelte';
	import {
		addClip,
		CLIP_FADE_OPTIONS,
		clipRange,
		freeRangeAt,
		MIN_CLIP_LENGTH,
		moveClip,
		moveClips,
		resizeBoundary,
		resizeClip,
		sortClips,
		updateLaneIn,
	} from '../../timeline/clips';
	import ConfirmDialog from '../ui/ConfirmDialog.svelte';

	/** Length a click-to-add clip gets, when the gap it lands in allows it. */
	const DEFAULT_CLIP_LENGTH = 6;
	const LANE_HEIGHT = 30;

	interface Props {
		lanes: FxLane[];
		selectedClipId?: string | null;
		/** The whole selection, for toolbar actions that live outside these lanes. */
		selectedClipIds?: string[];
		/** Lane picked by its name in the gutter, for the settings panel — a lane
		 * rolls and follows the music under its own settings, so the panel needs
		 * to know which one it is aimed at. A selected clip speaks for its lane,
		 * so this only carries a pick made with no clip selected. */
		selectedLaneId?: string | null;
		onChange: (lanes: FxLane[]) => void;
		/** Called before a change lands, while the pre-edit state is intact. */
		onBeforeEdit?: (coalesceKey?: string) => void;
		/** Beats per minute, when known — unlocks the beat-spaced re-roll options. */
		bpm?: number;
		onModeChange?: (
			clipIds: string[],
			mode: SequenceSegmentMode,
			intervalSec?: number,
			intervalBeats?: number | null,
		) => void;
		onRoll?: (clipIds: string[]) => void;
		onClear?: (clipIds: string[]) => void;
		/** Every row of the stack, front first — this lane's place in it. */
		layerOrder?: LayerRef[];
		/** Starts a row drag that reorders the whole stack. The editor owns it: a
		 * drag crosses into the text and media rows, which this can't see. */
		onLaneDragStart?: (laneId: string, e: PointerEvent) => void;
		/** Id of the row being dragged right now, for its lifted look. */
		draggingLaneId?: string | null;
	}

	let {
		lanes,
		selectedClipId = $bindable(null),
		selectedClipIds = $bindable([]),
		selectedLaneId = $bindable(null),
		onChange,
		onBeforeEdit,
		bpm = 0,
		onModeChange,
		onRoll,
		onClear,
		layerOrder = [],
		onLaneDragStart,
		draggingLaneId = null,
	}: Props = $props();

	// One axis for the whole stack: zoom, pan and playhead-following all live in
	// TimelineStack, the same as every other lane.
	const stack = getTimelineStack();
	const vp = stack.vp;
	let trackDuration = $derived(stack.trackDuration);

	/** Lane width in px, for sizing grab handles against their clips. The stack
	 * observes it once for every lane — they all share one geometry. */
	let laneWidthPx = $derived(stack.laneWidth);

	function laneTrack(node: HTMLElement, laneId: string) {
		const shared = stack.lane(node, laneId);
		// The lane is a split target for the S shortcut, keyed by its own id.
		const unregister = stack.registerSplitter(laneId, (t) => splitAt(laneId, t));
		return {
			destroy() {
				shared.destroy();
				unregister();
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
	let scrubbing = $state(false);

	/**
	 * Set on pointerdown when a plain click landed on an already-selected clip.
	 * The selection has to survive until pointerup so the clip (or the group) can
	 * still be dragged; only a click that turns out not to be a drag resolves it.
	 */
	let clickOnUp: string | null = null;

	function selectOnly(clipId: string) {
		selectedClipId = clipId;
		selectedClipIds = [clipId];
		// The clip's own lane speaks for the panel now; a lane picked earlier in
		// the gutter would otherwise come back the moment this clip is dropped.
		selectedLaneId = null;
	}

	function deselect() {
		selectedClipId = null;
		selectedClipIds = [];
	}

	/** Clicking a lane's name aims the settings panel at it; clicking it again
	 * hands the panel back to the editor's own settings. */
	function toggleLaneSelection(lane: FxLane) {
		if (selectedLaneId === lane.id) {
			selectedLaneId = null;
			return;
		}
		selectedLaneId = lane.id;
		deselect();
	}

	// Follow external changes to the primary, and drop ids whose clips are gone.
	$effect(() => {
		const id = selectedClipId;
		const alive = new Set(lanes.flatMap((l) => l.clips.map((c) => c.id)));
		untrack(() => {
			if (!id || !alive.has(id)) {
				if (selectedClipIds.length > 0) selectedClipIds = [];
				return;
			}
			const pruned = selectedClipIds.filter((x) => alive.has(x));
			if (!pruned.includes(id)) selectedClipIds = [id];
			else if (pruned.length !== selectedClipIds.length) selectedClipIds = pruned;
		});
	});

	// ── Clip toolbar ─────────────────────────────────────────────────────────
	// Rendered in the stack's shared selection bar rather than in a row of our
	// own: two bars duplicated the same controls, and each one appearing on
	// click resized the stack.
	$effect(() => {
		if (selectedClips.length === 0 || !onModeChange) return;
		return stack.registerSelectionBar('fx', clipBar);
	});

	// Every action fans out over the whole selection; a value the selection
	// disagrees on renders blank until the user picks one, which then applies to
	// all of them — the same convention the source lane's toolbar follows.
	let selectedClips = $derived(
		lanes.flatMap((l) => l.clips.filter((c) => selectedClipIds.includes(c.id))),
	);
	let many = $derived(selectedClips.length > 1);

	function commonValue<T>(values: T[]): T | undefined {
		return values.every((v) => v === values[0]) ? values[0] : undefined;
	}

	let commonMode = $derived(
		commonValue(selectedClips.map((c) => c.mode ?? 'static')),
	);
	let commonIntervalSec = $derived(
		commonValue(selectedClips.map((c) => c.intervalSec)),
	);
	let commonIntervalBeats = $derived(
		commonValue(selectedClips.map((c) => c.intervalBeats)),
	);
	let hasInterval = $derived(
		selectedClips.every((c) => c.intervalSec !== undefined),
	);

	let intervalValue = $derived.by(() => {
		if (commonIntervalBeats) return `b${commonIntervalBeats}`;
		if (commonIntervalBeats === undefined || commonIntervalSec === undefined) {
			return '';
		}
		return String(commonIntervalSec);
	});

	let commonFade = $derived(commonValue(selectedClips.map((c) => c.fadeSec ?? 0)));

	function setFade(sec: number) {
		const ids = new Set(selectedClipIds);
		onBeforeEdit?.();
		onChange(
			lanes.map((l) => ({
				...l,
				clips: l.clips.map((c) =>
					ids.has(c.id) ? { ...c, fadeSec: sec > 0 ? sec : undefined } : c,
				),
			})),
		);
	}

	/** A clip with no spacing yet takes one beat, or a flat second without a BPM. */
	function switchToAuto() {
		if (hasInterval) onModeChange?.(selectedClipIds, 'interval');
		else if (bpm > 0) onModeChange?.(selectedClipIds, 'interval', 60 / bpm, 1);
		else onModeChange?.(selectedClipIds, 'interval', 1, null);
	}

	/** Clips are placed freely — no grid, nothing to snap to. */
	function timeAt(clientX: number): number {
		return vp.clientXToTime(clientX);
	}

	function laneOf(laneId: string): FxLane | undefined {
		return lanes.find((l) => l.id === laneId);
	}

	function update(laneId: string, fn: (lane: FxLane) => FxLane) {
		onChange(updateLaneIn(lanes, laneId, fn));
	}

	/** Lane the delete button is asking about; null when nothing is pending. */
	let lanePendingDelete = $state<FxLane | null>(null);

	/** An empty lane takes nothing with it, so it goes without asking. */
	function requestDeleteLane(lane: FxLane) {
		if (lane.clips.length === 0) deleteLane(lane.id);
		else lanePendingDelete = lane;
	}

	function deleteLane(laneId: string) {
		lanePendingDelete = null;
		onBeforeEdit?.();
		// The lane id is its audio-link scope; its envelopes outlive it otherwise.
		dropAutoRangeScope(laneId);
		onChange(lanes.filter((l) => l.id !== laneId));
	}

	function toggleLane(lane: FxLane) {
		onBeforeEdit?.();
		update(lane.id, (l) => ({ ...l, enabled: !l.enabled }));
	}

	/** This lane's place in the stack it shares with the text and media rows. */
	function stackAt(laneId: string): number {
		return stackIndex(layerOrder, laneId);
	}

	function addClipAt(laneId: string, time: number) {
		const lane = laneOf(laneId);
		if (!lane) return;
		const gap = freeRangeAt(lane, time, trackDuration);
		if (!gap) return;
		const start = Math.max(gap.start, Math.min(time, gap.end - MIN_CLIP_LENGTH));
		const end = Math.min(start + DEFAULT_CLIP_LENGTH, gap.end);
		const clip = createFxClip(start, end);
		onBeforeEdit?.();
		update(laneId, (l) => addClip(l, clip, trackDuration));
		selectOnly(clip.id);
	}

	/**
	 * Cut the clip under the cursor in two. Ctrl+Click over empty lane space
	 * creates a clip instead (see onLanePointerDown), which together give the
	 * source lane's one "create / split at cursor" gesture.
	 */
	function splitAt(laneId: string, time: number) {
		const lane = laneOf(laneId);
		if (!lane) return;
		const next = splitFxClipAt(lane, time);
		// Not inside a clip, or one half would be too short to keep.
		if (next === lane) return;
		onBeforeEdit?.();
		update(laneId, () => next);
		// The clip the cursor was in is gone; leaving its id selected would show
		// the panel a chain that is no longer on the lane.
		deselect();
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
		// Ctrl+Shift toggles a single clip in or out: the additive pick that
		// plain Ctrl used to be, moved aside so Ctrl+Click can split the way it
		// does on the source lane. Checked before the plain-Shift range, which
		// would otherwise swallow it.
		if ((e.ctrlKey || e.metaKey) && e.shiftKey && mode === 'move') {
			if (selectedClipIds.includes(clipId)) {
				const rest = selectedClipIds.filter((x) => x !== clipId);
				selectedClipIds = rest;
				if (selectedClipId === clipId)
					selectedClipId = rest[rest.length - 1] ?? null;
			} else {
				selectedClipIds = [...selectedClipIds, clipId];
				selectedClipId = clipId;
			}
			return;
		}

		// Ctrl+Click cuts the clip at the cursor, the same gesture the source
		// lane uses. Handled on the edge handles too: they sit over the clip's
		// ends, and a cut there is no less unambiguous.
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
					selectedClipIds = range;
					return;
				}
			}
			selectOnly(clipId);
			return;
		}

		// A plain click on something already selected keeps the selection, so it
		// can be dragged; pointerup resolves it if nothing moved.
		if (selectedClipIds.includes(clipId) && mode === 'move') {
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
		onBeforeEdit?.(`fx-${mode}-${clipId}`);
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
		drag = { laneId, clipId: leftId, otherId: rightId, mode: 'boundary', grabOffset: 0 };
		onBeforeEdit?.(`fx-boundary-${leftId}`);
		(e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
	}

	/** Comfortable grab width for a shared boundary, in px. */
	const BOUNDARY_GRAB = 12;
	/** Comfortable grab width for a clip's own start/end handles, in px. */
	const EDGE_GRAB = 10;
	/** Below this the label is all ellipsis and no word. */
	const MIN_LABEL_PX = 34;

	/** Sized against the clip, so both edges stay grabbable at any width. */
	function edgeWidth(clip: FxClip): number {
		const px = clipPx(clip);
		if (px <= 0) return EDGE_GRAB;
		return Math.max(1, Math.min(EDGE_GRAB, px / 3));
	}

	/** The clip's on-screen width. */
	function clipPx(clip: FxClip): number {
		if (laneWidthPx <= 0) return 0;
		return ((clip.end - clip.start) / vp.viewDuration) * laneWidthPx;
	}

	/** Never take more than a third of the narrower neighbour, or a short clip
	 * would be blanketed by the boundary and leave nothing to click. */
	function boundaryWidth(left: FxClip, right: FxClip): number {
		if (laneWidthPx <= 0) return BOUNDARY_GRAB;
		const narrower = Math.min(left.end - left.start, right.end - right.start);
		const narrowerPx = (narrower / vp.viewDuration) * laneWidthPx;
		return Math.max(2, Math.min(BOUNDARY_GRAB, narrowerPx / 3));
	}

	/**
	 * Tooltip for a clip. Filled in on hover rather than rendered as an
	 * attribute: counting the enabled effects walks the clip's whole chain
	 * through its state proxy, which is more than the tooltip is worth on every
	 * clip of every lane, every frame the view pans. The clip carries an
	 * aria-label of its own, so nothing depends on this to be named.
	 */
	function clipTitle(clip: FxClip, label: string): string {
		if (clip.mode === 'interval') return `Re-rolls every ${label}`;
		let active = 0;
		for (const e of clip.effects) if (e.enabled) active++;
		return `${label} — ${active} effect${active === 1 ? '' : 's'}`;
	}

	/** Consecutive clip pairs sharing an exact edge — the draggable boundaries. */
	function adjacentPairs(
		lane: FxLane,
	): { left: FxClip; right: FxClip; at: number }[] {
		const clips = sortClips(lane.clips);
		const pairs: { left: FxClip; right: FxClip; at: number }[] = [];
		for (let i = 0; i + 1 < clips.length; i++) {
			if (clips[i].end === clips[i + 1].start) {
				pairs.push({ left: clips[i], right: clips[i + 1], at: clips[i].end });
			}
		}
		return pairs;
	}

	/** Empty lane space places the start marker and takes the clock with it,
	 * matching every other lane in the stack. Ctrl/Cmd drops a clip there
	 * instead. */
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
		update(laneId, (lane) => {
			if (mode === 'move') {
				// Dragging any member drags the whole selection with it. Measured as
				// a delta off the grabbed clip's live position, since each move
				// re-enters here against an already-shifted lane.
				if (selectedClipIds.length > 1 && selectedClipIds.includes(clipId)) {
					const held = lane.clips.find((c) => c.id === clipId);
					if (held) {
						return moveClips(
							lane,
							selectedClipIds,
							t - grabOffset - held.start,
							trackDuration,
						);
					}
				}
				return moveClip(lane, clipId, t - grabOffset, trackDuration);
			}
			// A boundary drag moves both clips' facing edges; the per-clip edges
			// trim one clip and can pull it away from its neighbour.
			if (mode === 'boundary') return resizeBoundary(lane, clipId, otherId!, t);
			return resizeClip(lane, clipId, mode, t, trackDuration);
		});
	}

	function onPointerUp(e: PointerEvent) {
		if (clickOnUp) {
			// Clicking the one selected clip again drops the selection — the same
			// gesture the source lane gives a segment.
			const sole = selectedClipIds.length === 1 && selectedClipIds[0] === clickOnUp;
			if (sole) deselect();
			else selectOnly(clickOnUp);
			clickOnUp = null;
		}
		scrubbing = false;
		if (!drag) return;
		drag = null;
		(e.currentTarget as HTMLElement).releasePointerCapture?.(e.pointerId);
	}

	/** Delete every selected clip, across lanes, as one undo step. */
	function deleteSelection() {
		const ids = new Set(selectedClipIds);
		if (ids.size === 0) return;
		onBeforeEdit?.();
		onChange(
			lanes.map((l) => ({ ...l, clips: l.clips.filter((c) => !ids.has(c.id)) })),
		);
		deselect();
	}

	function onKeyDown(e: KeyboardEvent) {
		if (isTextEntryTarget(e.target)) return;
		if (e.key === 'Escape' && selectedClipIds.length > 0) {
			deselect();
			return;
		}
		if (e.key !== 'Delete' && e.key !== 'Backspace') return;
		if (selectedClipIds.length === 0) return;
		e.preventDefault();
		deleteSelection();
	}
</script>

<svelte:window onkeydown={onKeyDown} />

<div class="fx-tl">
	{#each lanes as lane, i (lane.id)}
		<div
			class="tl-row fx-row"
			class:lifted={draggingLaneId === lane.id}
			style="order: {stackAt(lane.id)}"
			data-layer-id={lane.id}
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
					title={lane.enabled ? 'Mute this lane' : 'Unmute this lane'}
					onclick={() => toggleLane(lane)}
				>
					{#if lane.enabled}<Eye size={12} />{:else}<EyeOff size={12} />{/if}
				</button>
				<button
					class="lane-name"
					class:active={selectedLaneId === lane.id}
					title="{lane.name} — runs on everything below it in the stack. Click for its mosh and audio settings."
					onclick={() => toggleLaneSelection(lane)}>{lane.name}</button
				>
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
						{@const interval = clip.mode === 'interval'}
						{@const label = interval
							? intervalLabel(clip.intervalSec, clip.intervalBeats)
							: clip.modified
								? `${clip.label}*`
								: clip.label}
						<div
							class="clip"
							class:selected={selectedClipIds.includes(clip.id)}
							class:primary={selectedClipIds.length > 1 &&
								clip.id === selectedClipId}
							class:muted={!lane.enabled}
							class:interval
							style="left: {left}%; width: {width}%"
							role="button"
							tabindex="0"
							aria-label="{label} clip on {lane.name}"
							draggable="false"
							ondragstart={(e) => e.preventDefault()}
							onpointerenter={(e) => (e.currentTarget.title = clipTitle(clip, label))}
							onpointerdown={(e) => onClipPointerDown(e, lane.id, clip.id, 'move')}
						>
							<span
								class="clip-edge start"
								style="width: {edge}px"
								role="presentation"
								onpointerdown={(e) =>
									onClipPointerDown(e, lane.id, clip.id, 'start')}
							></span>
							{#if clipPx(clip) >= MIN_LABEL_PX}
								<span class="clip-label">{label}</span>
							{/if}
							<span
								class="clip-edge end"
								style="width: {edge}px"
								role="presentation"
								onpointerdown={(e) => onClipPointerDown(e, lane.id, clip.id, 'end')}
							></span>
						</div>
					{/if}
				{/each}

				{#each adjacentPairs(lane) as pair (pair.left.id)}
					{@const left = vp.toPct(pair.at)}
					{#if left >= 0 && left <= 100}
						<div
							class="clip-boundary"
							style="left: {left}%; width: {boundaryWidth(pair.left, pair.right)}px"
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
			message="This removes the lane and the {count} effect clip{count === 1
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

{#snippet clipBar()}
	{#if selectedClips.length > 0}
		<div class="fx-bar">
			<!-- Named, not just labelled: the bar is shared with the segment lane now,
			     so it has to say which of the two it is driving. -->
			<span class="fx-title">FX</span>
			<span class="tl-tool-label">
				{many ? `${selectedClips.length} clips` : selectedClips[0].label}
			</span>
			<button
				class="tl-tool-btn"
				title={commonMode === 'interval'
					? 'New random seed'
					: many
						? 'Random mosh for each selected clip'
						: 'Random mosh for this clip'}
				onclick={() => onRoll?.(selectedClipIds)}
			>
				<Dices size={12} /> Mosh
			</button>
			<button
				class="tl-tool-btn"
				title={many ? "Clear the selected clips' effects" : "Clear this clip's effects"}
				onclick={() => onClear?.(selectedClipIds)}
			>
				<Eraser size={12} /> Clear
			</button>

			<div class="tl-tool-sep"></div>
			<div class="fx-mode">
				<button
					class="tl-tool-btn"
					class:active={commonMode === 'static'}
					onclick={() => onModeChange?.(selectedClipIds, 'static')}
				>
					Static
				</button>
				<button
					class="tl-tool-btn"
					class:active={commonMode === 'interval'}
					onclick={switchToAuto}
				>
					Auto
				</button>
			</div>
			<div class="tl-tool-sep"></div>
			<span class="tl-tool-label">Fade</span>
			<select
				class="fx-select"
				value={commonFade === undefined ? '' : String(commonFade)}
				title="Ramp this lane's effects in and out at the clip's edges"
				onchange={(e) => {
					const v = e.currentTarget.value;
					if (v !== '') setFade(Number(v));
				}}
			>
				{#if commonFade === undefined}
					<option value="" disabled>—</option>
				{/if}
				<option value="0">none</option>
				{#each CLIP_FADE_OPTIONS as sec (sec)}
					<option value={String(sec)}>{sec}s</option>
				{/each}
			</select>

			{#if commonMode === 'interval'}
				<select
					class="fx-select"
					value={intervalValue}
					title="How often this clip re-rolls its mosh"
					onchange={(e) => {
						const v = e.currentTarget.value;
						if (v === '') return;
						if (v.startsWith('b')) {
							const beats = Number(v.slice(1));
							onModeChange?.(selectedClipIds, 'interval', (60 / bpm) * beats, beats);
						} else {
							// Picking a plain duration drops the beat link, so a later BPM
							// change leaves it alone.
							onModeChange?.(selectedClipIds, 'interval', Number(v), null);
						}
					}}
				>
					{#if intervalValue === ''}
						<option value="" disabled>—</option>
					{/if}
					{#if bpm > 0}
						{#each BEAT_INTERVALS as opt}
							<option value={`b${opt.beats}`}>{opt.label}</option>
						{/each}
					{/if}
					{#each [0.125, 0.25, 0.5, 1, 2] as sec}
						<!-- String, not the number: the select's value is a string and Svelte
						     matches an option by strict equality, so a numeric option value
						     never matches and the picker renders blank. -->
						<option value={String(sec)}>every {sec}s</option>
					{/each}
				</select>
			{/if}
		</div>
	{/if}
{/snippet}

<style>
	/* No box of its own: these rows join the stack column the layer lanes render
	   into, so one `order` per row interleaves all three kinds. */
	.fx-tl {
		display: contents;
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

	/* The row follows the pointer by re-ordering, not by moving, so this is the
	   only thing that says which one is in hand. */
	.fx-row.lifted {
		opacity: 0.55;
	}

	.lane-name {
		flex: 1;
		min-width: 0;
		border: none;
		background: none;
		padding: 0;
		text-align: left;
		cursor: pointer;
		color: var(--text-2);
		font-family: inherit;
		font-size: 0.65rem;
		white-space: nowrap;
		overflow: hidden;
		text-overflow: ellipsis;
	}

	.lane-name:hover {
		color: var(--text);
	}

	.lane-name.active {
		color: var(--live);
	}

	/* Fills the stack's selection bar, centred as one run. */
	.fx-bar {
		flex: 1;
		min-width: 0;
		display: flex;
		align-items: center;
		justify-content: center;
		gap: 0.35rem;
		padding: 0 0.25rem;
	}

	.fx-title {
		font-size: 0.68rem;
		font-weight: 600;
		color: var(--mosh);
		white-space: nowrap;
	}

	.fx-mode {
		display: flex;
	}

	.fx-mode :global(.tl-tool-btn:first-child) {
		border-right-color: transparent;
		border-radius: 4px 0 0 4px;
	}

	.fx-mode :global(.tl-tool-btn:last-child) {
		border-radius: 0 4px 4px 0;
	}

	/* The lane's own accent, rather than the stack toolbar's blue. */
	.fx-mode :global(.tl-tool-btn.active) {
		border-color: var(--mosh);
		background: rgba(198, 162, 234, 0.12);
		color: var(--mosh);
	}

	.fx-select {
		padding: 0.15rem 0.25rem;
		border: 1px solid var(--line);
		border-radius: 4px;
		background: var(--surface);
		color: var(--text-2);
		font-size: 0.65rem;
		font-family: inherit;
	}

	.lane-track {
		border: 1px solid var(--line);
		border-radius: 4px;
		background: var(--ink);
		overflow: hidden;
		touch-action: none;
	}

	/* Warmer than the text lane's blue: these stack onto the source chain rather
	   than laying over the frame, and the colour is what tells them apart at a
	   glance in a full stack. */
	.clip {
		position: absolute;
		top: 3px;
		bottom: 3px;
		display: flex;
		align-items: center;
		border: 1px solid var(--mosh-dim);
		border-radius: 3px;
		background: #33264a;
		color: var(--mosh);
		font-size: 0.68rem;
		cursor: grab;
		overflow: hidden;
		user-select: none;
		-webkit-user-drag: none;
	}

	.clip.selected {
		border-color: var(--mosh);
		background: var(--mosh-dim);
	}

	/* Which of a multi-selection the effects panel is editing. */
	.clip.primary {
		box-shadow: inset 0 0 0 1px var(--mosh);
	}

	.clip.muted {
		opacity: 0.4;
	}

	/* Dashed, because the chain under it is re-rolled rather than fixed —
	   the same "this isn't one held value" reading the label gives. */
	.clip.interval {
		border-style: dashed;
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
		background: var(--mosh);
	}

	.clip-boundary {
		position: absolute;
		top: 0;
		bottom: 0;
		transform: translateX(-50%);
		cursor: ew-resize;
		z-index: 3;
	}

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
		background: var(--mosh);
	}
</style>
