<script lang="ts">
	import { Focus } from "lucide-svelte";
	import { latestCopy, markCopied } from "../../editor/copy-stamp";
	import type { Preset } from "../../effects";
	import type { ChainMode } from "../../editor/sequence";
	import { getTimelineStack } from "../../editor/timeline-stack.svelte";
	import { ClipLaneController } from "../../timeline/clip-lane-controller.svelte";
	import {
		addClip,
		clipSourceId,
		copyMediaClips,
		createMediaClip,
		newClipSpan,
		pasteMediaClips,
		pasteMediaContentOnto,
		setMediaClipSources,
		sourcePlayLength,
		splitMediaClipAt,
		updateMediaLane,
		type MediaClip,
		type MediaClipboardEntry,
		type MediaLane,
		type MediaTimeline,
		type SourceEdit,
	} from "../../media";
	import type { SequenceSource } from "../../editor/sequence-sources.svelte";
	import { SOURCE_DND_TYPE } from "../../editor/sequence-source-ui";
	import { draggedSourceId } from "../../editor/source-drag.svelte";
	import { stackIndex, type LayerRef } from "../../timeline/layer-order";
	import ChainClipBar from "../timeline/ChainClipBar.svelte";
	import ClipBoundaries from "../timeline/ClipBoundaries.svelte";
	import ClipLaneGutter from "../timeline/ClipLaneGutter.svelte";
	import LaneDeleteDialog from "../timeline/LaneDeleteDialog.svelte";

	/** Length a click-to-add clip gets, when the gap it lands in allows it. */
	const DEFAULT_CLIP_LENGTH = 2;
	const LANE_HEIGHT = 30;
	/** A folded lane: its clips are still there to read, but not at a height that
	 * pays for the text inside them. A floor, not a height: the strip fills its
	 * row, so the gutter controls never leave slack under it. */
	const LANE_FOLDED_HEIGHT = 14;
	/** Shared so an unfolded panel allocates nothing per instance. */
	const NO_FOLDS: ReadonlySet<string> = new Set();
	/**
	 * Below this the label is all ellipsis and no word. The clip's tooltip still
	 * names its source, and the thumbnail strip still reads at any width.
	 */
	const MIN_LABEL_PX = 44;

	interface Props {
		timeline: MediaTimeline;
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
		/** The media pool, for naming and thumbnailing each lane's source. */
		sources?: SequenceSource[];
		/** Per-source edits, for how long a dropped video actually runs. */
		edits?: Record<string, SourceEdit>;
		/** Lane shown by itself on the canvas; null when nothing is soloed. */
		soloLaneId?: string | null;
		onToggleSolo?: (laneId: string) => void;
		selectedClipId?: string | null;
		/**
		 * The whole selection, so the media rail can assign to all of it.
		 * `selectedClipId` stays the primary — the one the clip panel edits and
		 * the anchor a shift-range extends from — and is always a member here.
		 */
		selectedClipIds?: string[];
		onChange: (timeline: MediaTimeline) => void;
		/** Called before a change lands, while the pre-edit state is intact. */
		onBeforeEdit?: (coalesceKey?: string) => void;
		/** Beats per minute, when known — unlocks the beat-spaced re-roll options. */
		bpm?: number;
		// The clip chain gestures, the same set an fx clip takes.
		// All optional: without them the bar isn't offered at all.
		onApplyPreset?: (clipIds: string[], preset: Preset) => void;
		onRoll?: (clipIds: string[]) => void;
		onClear?: (clipIds: string[]) => void;
		onModeChange?: (
			clipIds: string[],
			mode: ChainMode,
			intervalSec?: number,
			intervalBeats?: number | null,
		) => void;
	}

	let {
		timeline,
		layerOrder = [],
		onLaneDragStart,
		draggingLaneId = null,
		foldedLaneIds = NO_FOLDS,
		onToggleFold,
		sources = [],
		edits = {},
		soloLaneId = null,
		onToggleSolo,
		selectedClipId = $bindable(null),
		selectedClipIds = $bindable([]),
		onChange,
		onBeforeEdit,
		bpm = 0,
		onApplyPreset,
		onRoll,
		onClear,
		onModeChange,
	}: Props = $props();

	// One axis for the whole stack: zoom, pan, playhead-following and the
	// duration-change reset all live in TimelineStack.
	const stack = getTimelineStack();
	const vp = stack.vp;
	let trackDuration = $derived(stack.trackDuration);

	// Selection, drags, scrubbing, split/add/delete and the keyboard — the
	// gestures every clip lane shares. Reads the props live through the getters.
	const ctrl = new ClipLaneController<MediaClip, MediaLane>(
		{
			kind: "media",
			defaultClipLength: DEFAULT_CLIP_LENGTH,
			get lanes() {
				return timeline.lanes;
			},
			setLanes: (lanes) => onChange({ ...timeline, lanes }),
			onBeforeEdit: (key) => onBeforeEdit?.(key),
			get selectedClipId() {
				return selectedClipId;
			},
			set selectedClipId(v) {
				selectedClipId = v;
			},
			get selectedClipIds() {
				return selectedClipIds;
			},
			set selectedClipIds(v) {
				selectedClipIds = v;
			},
			createClip: (start, end) => createMediaClip(start, end),
			splitClipAt: splitMediaClipAt,
			clipSpanAt: (lane, time) => clipSpanAt(lane, time),
			// A clip keeps showing what it showed: one that inherited its old
			// lane's source has it pinned, unless the new lane shows the same.
			remapOnLaneChange: (clip, from, to) => {
				const sourceId = clip.sourceId ?? from.sourceId ?? undefined;
				return {
					...clip,
					sourceId: sourceId === to.sourceId ? undefined : sourceId,
				};
			},
			copy: copySelection,
			paste: pasteClipboard,
		},
		stack,
	);
	$effect(() => ctrl.syncSelection());

	// ── Clip toolbar ─────────────────────────────────────────────────────────
	// Rendered in the stack's shared selection bar, like the fx lanes' — one
	// bar for whichever lane holds the selection, so the stack never resizes.
	let selectedClips = $derived(ctrl.selectedClips);
	$effect(() => {
		if (selectedClips.length === 0 || !onModeChange) return;
		return stack.registerSelectionBar("media", clipBar);
	});

	// ── Source drops ─────────────────────────────────────────────────────────
	// The same payload the media rail and the sequence grid send, so a thumb
	// dragged onto a lane either retargets the clip it lands on or lays down a
	// new one in the gap it fell in.
	let dropLaneId = $state<string | null>(null);
	/** The clip a drop would retarget; null when it would make a new one. */
	let dropClipId = $state<string | null>(null);
	/** Where a drop on empty space would put its clip. Drawn as a ghost, so the
	 * span is settled before the media lands rather than after. */
	let dropGhost = $state<{
		laneId: string;
		start: number;
		end: number;
	} | null>(null);
	/** The media in the air — the drag payload itself is sealed until the drop. */
	let ghostSource = $derived(sourceById(draggedSourceId()));

	function isSourceDrag(e: DragEvent): boolean {
		return !!e.dataTransfer?.types.includes(SOURCE_DND_TYPE);
	}

	function clearDrop() {
		dropLaneId = null;
		dropClipId = null;
		dropGhost = null;
	}

	function onLaneDragOver(e: DragEvent, laneId: string) {
		if (!isSourceDrag(e)) return;
		// Without preventDefault the browser refuses the drop entirely.
		e.preventDefault();
		const onClip = dropTargetClip(laneId, e.clientX);
		dropLaneId = laneId;
		dropClipId = onClip?.id ?? null;
		dropGhost = onClip ? null : ghostAt(laneId, e.clientX);
		// "none" over a gap too narrow to hold a clip: the cursor is the only
		// thing that can say so before the drop does nothing.
		if (e.dataTransfer) {
			e.dataTransfer.dropEffect = onClip || dropGhost ? "copy" : "none";
		}
	}

	/** Where the clip a drop at this x would create lands, or null if none fits. */
	function ghostAt(
		laneId: string,
		clientX: number,
	): { laneId: string; start: number; end: number } | null {
		const lane = ctrl.laneOf(laneId);
		if (!lane || trackDuration <= 0 || !ctrl.overTrack(clientX)) return null;
		const span = clipSpanAt(lane, ctrl.timeAt(clientX), draggedSourceId());
		return span && { laneId, ...span };
	}

	/** The clip a drop at this x would land on, if it lands on one at all. */
	function dropTargetClip(laneId: string, clientX: number): MediaClip | null {
		const lane = ctrl.laneOf(laneId);
		if (!lane || !ctrl.overTrack(clientX)) return null;
		const t = ctrl.timeAt(clientX);
		return lane.clips.find((c) => t >= c.start && t < c.end) ?? null;
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
		clearDrop();
	}

	/**
	 * A thumb dropped on a clip retargets that clip alone; one dropped on the
	 * lane's empty space lays down a new clip there showing it. That split is
	 * what lets one lane hold several images without the drop having to ask
	 * which it meant.
	 */
	function onLaneDrop(e: DragEvent, laneId: string) {
		if (!isSourceDrag(e)) return;
		e.preventDefault();
		const sourceId = e.dataTransfer?.getData(SOURCE_DND_TYPE) ?? "";
		const onClip = dropTargetClip(laneId, e.clientX);
		const ghost = dropGhost;
		clearDrop();
		const lane = ctrl.laneOf(laneId);
		if (!sourceId || !lane) return;
		if (onClip) {
			if (clipSourceId(lane, onClip) === sourceId) return;
			onBeforeEdit?.();
			onChange(setMediaClipSources(timeline, [onClip.id], sourceId));
			return;
		}
		if (!ghost || ghost.laneId !== laneId) return;
		// A lane with no media of its own takes the drop as its default too, so
		// its picker has something to name and later clips inherit it; after
		// that the new clip carries the source itself and the lane is left be.
		const inherits = lane.sourceId === null || lane.sourceId === sourceId;
		const clip = createMediaClip(
			ghost.start,
			ghost.end,
			0,
			inherits ? undefined : sourceId,
		);
		onBeforeEdit?.();
		onChange(
			updateMediaLane(timeline, laneId, (l) => ({
				...addClip(l, clip, trackDuration),
				sourceId: inherits ? sourceId : l.sourceId,
			})),
		);
		ctrl.selectOnly(clip.id);
	}

	function sourceById(id: string | null): SequenceSource | undefined {
		return id ? sources.find((s) => s.id === id) : undefined;
	}

	/** The media a clip actually draws — its own when it was retargeted. */
	function clipSource(
		lane: MediaLane,
		clip: MediaClip,
	): SequenceSource | undefined {
		return sourceById(clipSourceId(lane, clip));
	}

	/** What a clip says it is showing. Clips with no source read as unset. */
	function clipLabel(lane: MediaLane, clip: MediaClip): string {
		return clipSource(lane, clip)?.name ?? "No source";
	}

	/** The chain's label, unless it is the default a fresh clip carries — a
	 * row of "clean" says nothing the empty rack doesn't. */
	function chainLabel(clip: MediaClip): string | null {
		if (clip.label === "clean" && !clip.modified) return null;
		return clip.modified ? `${clip.label}*` : clip.label;
	}

	/**
	 * Turning solo on aims the sidebar at the lane too — the point of seeing one
	 * layer by itself is to work on it, and hunting for its clip afterwards is
	 * the step that was missing.
	 *
	 * Only ever an existing clip, unlike `openLane`: soloing is a way of looking
	 * at the timeline, and it must not write to it.
	 */
	function soloLane(lane: MediaLane) {
		const turningOn = soloLaneId !== lane.id;
		onToggleSolo?.(lane.id);
		if (!turningOn) return;
		const first = [...lane.clips].sort((a, b) => a.start - b.start)[0];
		if (first) ctrl.selectOnly(first.id);
	}

	/**
	 * The span a clip added at `time` gets. A video asks for its own length —
	 * as trimmed and at its speed, the stretch it takes to play through once —
	 * so dropping one lays down the whole shot rather than a stub; everything
	 * else takes the default.
	 */
	function clipSpanAt(
		lane: MediaLane,
		time: number,
		sourceId?: string | null,
	): { start: number; end: number } | null {
		const source = sourceById(sourceId ?? null);
		const duration = source
			? sourcePlayLength(edits[source.id], source.duration ?? 0)
			: 0;
		return newClipSpan(
			lane,
			time,
			trackDuration,
			duration > 0 ? duration : DEFAULT_CLIP_LENGTH,
		);
	}

	// ── Clip clipboard ───────────────────────────────────────────────────────
	// Local to the lanes. The selections are mutually exclusive, so a Ctrl+C
	// with clips selected can only mean these. A paste goes onto the selection
	// when there is one — what the copied clips showed, into clips that keep
	// their spans — and otherwise stamps whole clips down at the start marker.
	let clipboard = $state<MediaClipboardEntry[]>([]);
	/** What the clipboard was copied from, plus every copy stamped from it
	 * since: pasting onto exactly those would change nothing, so that gesture
	 * stamps new copies instead — which is what makes a second Ctrl+V, with
	 * the first paste still selected, lay down another copy. */
	let copiedIds = new Set<string>();
	/** The copy stamp when the clipboard was last filled: a paste answers only
	 * if nothing was copied on another lane since. */
	let clipStamp = -1;

	function copySelection(): boolean {
		if (selectedClipIds.length === 0) return false;
		clipboard = copyMediaClips(timeline, selectedClipIds);
		copiedIds = new Set(selectedClipIds);
		if (clipboard.length === 0) return false;
		clipStamp = markCopied();
		return true;
	}

	function pasteClipboard(): boolean {
		if (clipboard.length === 0 || latestCopy() !== clipStamp) return false;
		const ontoSelf =
			selectedClipIds.length > 0 &&
			selectedClipIds.every((id) => copiedIds.has(id));
		if (selectedClipIds.length > 0 && !ontoSelf) {
			onBeforeEdit?.();
			onChange(pasteMediaContentOnto(timeline, selectedClipIds, clipboard));
			return true;
		}
		return pasteClips();
	}

	/** Stamp the copied clips at the start marker, on the lane last clicked —
	 * the same click that put the marker there — and leave the copies selected
	 * to drag from there. */
	function pasteClips(): boolean {
		const result = pasteMediaClips(
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
		selectedClipIds = result.clipIds;
		selectedClipId = result.clipIds[result.clipIds.length - 1];
		return true;
	}
</script>

<svelte:window onkeydown={(e) => ctrl.onKeyDown(e)} />

<div class="media-tl">
	{#each timeline.lanes as lane (lane.id)}
		<!-- svelte-ignore a11y_no_static_element_interactions -->
		<div
			class="tl-row"
			class:lifted={draggingLaneId === lane.id}
			class:drop-target={dropLaneId === lane.id && !dropClipId}
			class:folded={foldedLaneIds.has(lane.id)}
			style="order: {stackIndex(layerOrder, lane.id)}"
			data-layer-id={lane.id}
			data-lane-kind="media"
			ondragover={(e) => onLaneDragOver(e, lane.id)}
			ondragleave={onLaneDragLeave}
			ondrop={(e) => onLaneDrop(e, lane.id)}
		>
			<ClipLaneGutter
				{lane}
				{layerOrder}
				{onLaneDragStart}
				folded={foldedLaneIds.has(lane.id)}
				{onToggleFold}
				onToggleEnabled={() => ctrl.setLane(lane.id, "enabled", !lane.enabled)}
				nameTitle="{lane.name} — click to edit this layer's placement and effects."
				onNameClick={() => ctrl.openLane(lane)}
				onRename={(name) => ctrl.setLane(lane.id, "name", name)}
				onDelete={() => ctrl.requestDeleteLane(lane)}
			>
				{#if onToggleSolo}
					<button
						class="lane-solo"
						class:on={soloLaneId === lane.id}
						title={soloLaneId === lane.id
							? "Stop soloing — show the whole frame again"
							: "Solo: show only this layer on the canvas"}
						aria-pressed={soloLaneId === lane.id}
						onclick={() => soloLane(lane)}
					>
						<Focus size={12} />
					</button>
				{/if}
			</ClipLaneGutter>

			<div
				class="tl-lane lane-track"
				use:ctrl.laneTrack={lane.id}
				style={foldedLaneIds.has(lane.id)
					? `min-height: ${LANE_FOLDED_HEIGHT}px`
					: `height: ${LANE_HEIGHT}px`}
				role="group"
				aria-label="{lane.name} clips"
				ondblclick={(e) => ctrl.onTrackDblClick(e, lane.id)}
				onpointerdown={(e) => ctrl.onLanePointerDown(e, lane.id)}
				onpointermove={(e) => ctrl.onPointerMove(e)}
				onpointerup={(e) => ctrl.onPointerUp(e)}
				onpointercancel={(e) => ctrl.onPointerUp(e)}
			>
				{#each lane.clips as clip (clip.id)}
					{@const left = vp.toPct(clip.start)}
					{@const width = vp.toPct(clip.end) - left}
					{@const edge = ctrl.edgeWidth(clip)}
					{@const src = clipSource(lane, clip)}
					{#if left < 100 && left + width > 0}
						<div
							class="clip"
							class:selected={selectedClipIds.includes(clip.id)}
							class:primary={selectedClipIds.length > 1 &&
								clip.id === selectedClipId}
							class:muted={!lane.enabled}
							class:retargeted={!!clip.sourceId}
							class:drop-target={dropClipId === clip.id}
							style="left: {left}%; width: {width}%"
							role="button"
							tabindex="0"
							title="{clipLabel(lane, clip)} — double-click to edit"
							ondblclick={() => ctrl.openLane(lane)}
							draggable="false"
							ondragstart={(e) => e.preventDefault()}
							onpointerdown={(e) =>
								ctrl.onClipPointerDown(e, lane.id, clip.id, "move")}
						>
							<span
								class="clip-edge start"
								style="width: {edge}px"
								role="presentation"
								onpointerdown={(e) =>
									ctrl.onClipPointerDown(e, lane.id, clip.id, "start")}
							></span>
							{#if src?.thumbUrl}
								<span
									class="clip-thumb"
									style="background-image: url({src.thumbUrl})"
								></span>
							{/if}
							{#if ctrl.clipPx(clip) >= MIN_LABEL_PX}
								<span class="clip-label">
									{clipLabel(lane, clip)}
									{#if chainLabel(clip)}
										<span class="clip-chain">{chainLabel(clip)}</span>
									{/if}
								</span>
							{/if}
							<span
								class="clip-edge end"
								style="width: {edge}px"
								role="presentation"
								onpointerdown={(e) =>
									ctrl.onClipPointerDown(e, lane.id, clip.id, "end")}
							></span>
						</div>
					{/if}
				{/each}

				{#if dropGhost?.laneId === lane.id}
					{@const left = vp.toPct(dropGhost.start)}
					{@const width = vp.toPct(dropGhost.end) - left}
					<div class="clip ghost" style="left: {left}%; width: {width}%">
						{#if ghostSource?.thumbUrl}
							<span
								class="clip-thumb"
								style="background-image: url({ghostSource.thumbUrl})"
							></span>
						{/if}
						{#if ctrl.clipPx(dropGhost) >= MIN_LABEL_PX}
							<span class="clip-label">{ghostSource?.name ?? "New clip"}</span>
						{/if}
					</div>
				{/if}

				<ClipBoundaries {ctrl} {lane} />
			</div>
		</div>
	{/each}

	{#if ctrl.lanePendingDelete}
		<LaneDeleteDialog
			lane={ctrl.lanePendingDelete}
			laneNoun="layer"
			onConfirm={(id) => ctrl.deleteLane(id)}
			onCancel={() => (ctrl.lanePendingDelete = null)}
		/>
	{/if}
</div>

{#snippet clipBar()}
	<ChainClipBar
		title="Layer"
		{selectedClips}
		label={(c) => chainLabel(c as MediaClip) ?? "clean"}
		{bpm}
		{onApplyPreset}
		{onRoll}
		{onClear}
		{onModeChange}
	/>
{/snippet}

<style>
	/* The chain rides after the media name, dimmer: what it shows first, what
	   runs on it second. */
	.clip-chain {
		margin-left: 0.35rem;
		color: var(--mosh);
		opacity: 0.85;
	}

	/* No box of its own: the rows join the layer column their sibling component
	   renders into, so one `order` per row interleaves the two kinds. */
	.media-tl {
		display: contents;
	}

	/* A source is being dragged over this row's empty space and a clip would be
	   cut for it. Over a clip the clip lights instead — the drop retargets that
	   one clip, and lighting the whole row would promise otherwise. */
	.tl-row.drop-target .lane-track {
		border-color: var(--live);
		box-shadow: inset 0 0 0 1px var(--live);
	}

	/* Lit rather than dimmed, unlike the eye: solo is a mode the editor is in,
	   and one the user has to be able to spot from across the timeline to
	   explain why the canvas is showing one layer on black. */
	.lane-solo:hover {
		color: var(--text);
	}

	.lane-solo.on {
		color: var(--mosh);
	}

	/* A clip showing something other than its lane's source. Left corner, so it
	   survives a clip narrow enough to lose its label. */
	.clip.retargeted::after {
		content: "";
		position: absolute;
		top: 2px;
		left: 2px;
		width: 3px;
		height: 3px;
		border-radius: 50%;
		background: var(--mosh);
		pointer-events: none;
	}

	/* The clip a drop would make, at the span it would get: the gesture has to
	   say where the media lands while there is still time to move it. Dashed
	   and pale so it never reads as a clip that is already there. */
	.clip.ghost {
		border-style: dashed;
		border-color: var(--mosh);
		background: rgba(0, 0, 0, 0.35);
		color: var(--text-2);
		pointer-events: none;
	}

	.clip.drop-target {
		border-color: var(--mosh);
		box-shadow: inset 0 0 0 1px var(--mosh);
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
</style>
