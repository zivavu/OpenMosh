<script lang="ts">
	import { Focus, Volume2, VolumeX } from "lucide-svelte";
	import type { MixSegment } from "../../mix/plan";
	import { DEFAULT_LANE_AUDIO } from "../../mix/types";
	import LaneWaveform from "../timeline/LaneWaveform.svelte";
	import ClipRepeats from "../timeline/ClipRepeats.svelte";
	import {
		repeatNote,
		videoClipRepeats,
		videoSourceEnds,
	} from "../../mix/plan";
	import { TRANSITION_OPTIONS, transitionLength } from "../../media/transition";
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
	import ClipVolume from "../timeline/ClipVolume.svelte";
	import ClipBoundaries from "../timeline/ClipBoundaries.svelte";
	import ClipLaneGutter from "../timeline/ClipLaneGutter.svelte";
	import LaneDeleteDialog from "../timeline/LaneDeleteDialog.svelte";
	import TransitionPopover from "./TransitionPopover.svelte";
	import { updateMediaClips } from "../../media/resolve";

	const DEFAULT_CLIP_LENGTH = 2;
	const LANE_HEIGHT = 30;
	/** A folded lane: clips stay readable, but not at a height that pays for the
	 * text inside. */
	const LANE_FOLDED_HEIGHT = 14;
	const NO_FOLDS: ReadonlySet<string> = new Set();
	/** Below this the label is all ellipsis and no word. */
	const MIN_LABEL_PX = 44;

	interface Props {
		timeline: MediaTimeline;
		layerOrder?: LayerRef[];
		onLaneDragStart?: (laneId: string, e: PointerEvent) => void;
		draggingLaneId?: string | null;
		foldedLaneIds?: ReadonlySet<string>;
		onToggleFold?: (laneId: string) => void;
		sources?: SequenceSource[];
		edits?: Record<string, SourceEdit>;
		soloLaneId?: string | null;
		onToggleSolo?: (laneId: string) => void;
		selectedClipId?: string | null;
		/** The whole selection, so the media rail can assign to all of it. `selectedClipId`
		 * stays the primary and is always a member here. */
		selectedClipIds?: string[];
		onChange: (timeline: MediaTimeline) => void;
		/** Called before a change lands, while the pre-edit state is intact. */
		onBeforeEdit?: (coalesceKey?: string) => void;
		/** Beats per minute, when known: unlocks the beat-spaced re-roll options. */
		bpm?: number;
		onApplyPreset?: (clipIds: string[], preset: Preset) => void;
		onRoll?: (clipIds: string[]) => void;
		onClear?: (clipIds: string[]) => void;
		onModeChange?: (
			clipIds: string[],
			mode: ChainMode,
			intervalSec?: number,
			intervalBeats?: number | null,
		) => void;
		/** The mix, for the sound strip under each video clip. */
		plan?: MixSegment[];
		peaksOf?: (sourceId: string) => Float32Array | null;
		audioVersion?: number;
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
		plan,
		peaksOf,
		audioVersion = 0,
	}: Props = $props();

	// One axis for the whole stack: zoom, pan and playhead-following live in
	// TimelineStack.
	const stack = getTimelineStack();
	const vp = stack.vp;
	let trackDuration = $derived(stack.trackDuration);

	// Selection, drags, scrubbing, split/add/delete and the keyboard: the gestures
	// every clip lane shares.
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
			// A clip keeps showing what it showed: one that inherited its old lane's source
			// has it pinned, unless the new lane shows the same.
			remapOnLaneChange: (clip, from, to) => {
				const sourceId = clip.sourceId ?? from.sourceId ?? undefined;
				return {
					...clip,
					sourceId: sourceId === to.sourceId ? undefined : sourceId,
				};
			},
			copy: copySelection,
			paste: pasteClipboard,
			onJoinClick: (ids, anchor) => (joinPopover = { ids, anchor }),
			sourceEnds: (clip, lane, until) => {
				const src = clipSource(lane, clip);
				return src?.kind === "video"
					? videoSourceEnds(edits[src.id], src.duration, clip, until)
					: [];
			},
			readJoin: (clip) => clip.transition,
			writeJoin: (clip, transition) => ({
				...clip,
				transition: transition as MediaClip["transition"],
			}),
		},
		stack,
	);

	/** The joins a click opened the transition editor on, by the clip blending in. */
	let joinPopover = $state<{ ids: string[]; anchor: DOMRect } | null>(null);
	let joinClips = $derived(
		joinPopover
			? timeline.lanes.flatMap((l) =>
					l.clips.filter((c) => joinPopover!.ids.includes(c.id)),
				)
			: [],
	);
	// Merged, deleted or undone away while open: nothing left to edit.
	$effect(() => {
		if (joinPopover && joinClips.length === 0) joinPopover = null;
	});

	function editJoinTransitions(
		edit: (t: MediaClip["transition"]) => MediaClip["transition"],
	) {
		if (!joinPopover) return;
		onBeforeEdit?.();
		onChange(
			updateMediaClips(timeline, new Set(joinPopover.ids), (c) => ({
				...c,
				transition: edit(c.transition),
			})),
		);
	}
	$effect(() => ctrl.syncSelection());

	// Rendered in the stack's shared selection bar, like the fx lanes'.
	let selectedClips = $derived(ctrl.selectedClips);

	/** Selected clips playing their video's own sound, which the bar's volume sets. */
	let soundClips = $derived(
		timeline.lanes.flatMap((lane) =>
			(lane.audio ?? DEFAULT_LANE_AUDIO).muted
				? []
				: lane.clips.filter(
						(c) =>
							selectedClipIds.includes(c.id) &&
							!c.audioDetached &&
							clipSource(lane, c)?.kind === "video",
					),
		),
	);
	let commonGain = $derived.by(() => {
		const gains = soundClips.map((c) => c.gain ?? 1);
		return gains.every((g) => g === gains[0]) ? gains[0] : undefined;
	});

	function setSoundGain(gain: number | undefined, coalesceKey?: string) {
		onBeforeEdit?.(coalesceKey);
		onChange(
			updateMediaClips(timeline, new Set(soundClips.map((c) => c.id)), (c) => ({
				...c,
				gain,
			})),
		);
	}
	$effect(() => {
		if (selectedClips.length === 0 || !onModeChange) return;
		return stack.registerSelectionBar("media", clipBar);
	});

	// The same payload the media rail and the sequence grid send, so a thumb dragged
	// onto a lane either retargets the clip it lands on or lays down a new one.
	let dropLaneId = $state<string | null>(null);
	let dropClipId = $state<string | null>(null);
	/** Where a drop on empty space would put its clip, drawn as a ghost. */
	let dropGhost = $state<{
		laneId: string;
		start: number;
		end: number;
	} | null>(null);
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
		// "none" over a gap too narrow to hold a clip: the cursor is the only thing that
		// can say so before the drop does nothing.
		if (e.dataTransfer) {
			e.dataTransfer.dropEffect = onClip || dropGhost ? "copy" : "none";
		}
	}

	function ghostAt(
		laneId: string,
		clientX: number,
	): { laneId: string; start: number; end: number } | null {
		const lane = ctrl.laneOf(laneId);
		if (!lane || trackDuration <= 0 || !ctrl.overTrack(clientX)) return null;
		const span = clipSpanAt(lane, ctrl.timeAt(clientX), draggedSourceId());
		return span && { laneId, ...span };
	}

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

	/** A thumb dropped on a clip retargets that clip alone; one dropped on the lane's
	 * empty space lays down a new clip there showing it. */
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
		// A lane with no media of its own takes the drop as its default too.
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

	function clipSource(
		lane: MediaLane,
		clip: MediaClip,
	): SequenceSource | undefined {
		return sourceById(clipSourceId(lane, clip));
	}

	function clipLabel(lane: MediaLane, clip: MediaClip): string {
		return clipSource(lane, clip)?.name ?? "No source";
	}

	function transitionNote(clip: MediaClip): string {
		const t = clip.transition;
		if (!t || transitionLength(clip) <= 0) return "";
		const label = TRANSITION_OPTIONS.find((o) => o.value === t.type)?.label;
		return ` — ${label} in`;
	}

	/** Only a lane that can play a video has sound to mute. */
	function laneHasVideo(lane: MediaLane): boolean {
		if (sourceById(lane.sourceId)?.kind === "video") return true;
		return lane.clips.some((c) => clipSource(lane, c)?.kind === "video");
	}

	function toggleSound(lane: MediaLane) {
		const audio = lane.audio ?? DEFAULT_LANE_AUDIO;
		onBeforeEdit?.();
		onChange(
			updateMediaLane(timeline, lane.id, (l) => ({
				...l,
				audio: { ...audio, muted: !audio.muted },
			})),
		);
	}

	function chainLabel(clip: MediaClip): string | null {
		if (clip.label === "clean" && !clip.modified) return null;
		return clip.modified ? `${clip.label}*` : clip.label;
	}

	/** Turning solo on aims the sidebar at the lane too. Only ever an existing clip,
	 * unlike `openLane`: soloing must not write to the timeline. */
	function soloLane(lane: MediaLane) {
		const turningOn = soloLaneId !== lane.id;
		onToggleSolo?.(lane.id);
		if (!turningOn) return;
		const first = [...lane.clips].sort((a, b) => a.start - b.start)[0];
		if (first) ctrl.selectOnly(first.id);
	}

	/** The span a clip added at `time` gets. A video asks for its own length (as
	 * trimmed and at its speed), so dropping one lays down the whole shot. */
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

	// Local to the lanes. The selections are mutually exclusive, so a Ctrl+C with
	// clips selected can only mean these.
	let clipboard = $state<MediaClipboardEntry[]>([]);
	/** What the clipboard was copied from, plus every copy stamped since. */
	let copiedIds = new Set<string>();
	/** The copy stamp when the clipboard was last filled; a paste answers only if it
	 * matches. */
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
				{#if plan && laneHasVideo(lane)}
					{const muted = $derived(lane.audio?.muted ?? false)}
					<button
						class="lane-sound"
						class:off={muted}
						aria-pressed={!muted}
						title={muted
							? "Sound muted — click to hear this layer's videos"
							: "Sound on — click to mute this layer's videos"}
						onclick={() => toggleSound(lane)}
					>
						{#if muted}<VolumeX size={12} />{:else}<Volume2 size={12} />{/if}
					</button>
				{/if}
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
					{const left = $derived(vp.toPct(clip.start))}
					{const width = $derived(vp.toPct(clip.end) - left)}
					{const edge = $derived(ctrl.edgeWidth(clip))}
					{const src = $derived(clipSource(lane, clip))}
					{const repeats = $derived(
						src?.kind === "video"
							? videoClipRepeats(edits[src.id], src.duration, clip)
							: [],
					)}
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
							title="{clipLabel(lane, clip)}{transitionNote(clip)}{repeatNote(
								repeats,
							)} — double-click to edit"
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
							{#if transitionLength(clip) > 0}
								<span
									class="clip-transition"
									style="width: {(transitionLength(clip) /
										(clip.end - clip.start)) *
										100}%"
								></span>
							{/if}
							<ClipRepeats {clip} times={repeats} px={ctrl.clipPx(clip)} />
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

				{#if plan && peaksOf && !foldedLaneIds.has(lane.id)}
					<LaneWaveform
						variant="strip"
						segments={plan.filter((seg) => seg.laneId === lane.id)}
						{peaksOf}
						version={audioVersion}
					/>
				{/if}

				{#if dropGhost?.laneId === lane.id}
					{const left = $derived(vp.toPct(dropGhost.start))}
					{const width = $derived(vp.toPct(dropGhost.end) - left)}
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

	{#if joinPopover}
		<TransitionPopover
			anchor={joinPopover.anchor}
			transitions={joinClips.map((c) => c.transition)}
			onChange={editJoinTransitions}
			onClose={() => (joinPopover = null)}
		/>
	{/if}

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
	>
		{#snippet leading()}
			{#if soundClips.length > 0}
				<ClipVolume
					value={commonGain}
					onInput={(v) =>
						setSoundGain(
							v === 1 ? undefined : v,
							`media-gain-${selectedClipIds.join(",")}`,
						)}
					onReset={() => setSoundGain(undefined)}
				/>
			{/if}
		{/snippet}
	</ChainClipBar>
{/snippet}

<style>
	/* The chain rides after the media name, dimmer: what it shows first, what runs on
	   it second. */
	.clip-chain {
		margin-left: 0.35rem;
		color: var(--mosh);
		opacity: 0.85;
	}

	/* No box of its own: the rows join the layer column their sibling renders into. */
	.media-tl {
		display: contents;
	}

	/* A source is being dragged over this row's empty space and a clip would be cut. */
	.tl-row.drop-target .lane-track {
		border-color: var(--live);
		box-shadow: inset 0 0 0 1px var(--live);
	}

	.lane-sound:hover {
		color: var(--text);
	}

	.lane-sound.off {
		color: var(--text-4);
	}

	/* Lit rather than dimmed, unlike the eye: solo is a mode the editor is in. */
	.lane-solo:hover {
		color: var(--text);
	}

	.lane-solo.on {
		color: var(--mosh);
	}

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

	/* The clip a drop would make, at the span it would get. */
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

	/* The source's thumbnail, tiled along the clip: a filmstrip reads as "this media"
	   faster than the file name. */
	/* A wedge over the stretch the clip spends blending in. */
	.clip-transition {
		position: absolute;
		top: 0;
		bottom: 0;
		left: 0;
		background: linear-gradient(
			to top right,
			color-mix(in srgb, var(--clip-accent) 40%, transparent) 50%,
			transparent 50%
		);
		border-right: 1px solid
			color-mix(in srgb, var(--clip-accent) 60%, transparent);
		pointer-events: none;
	}

	.clip-thumb {
		position: absolute;
		inset: 0;
		background-size: auto 100%;
		background-repeat: repeat-x;
		opacity: 0.35;
		pointer-events: none;
	}
</style>
