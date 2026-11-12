<script lang="ts">
	import KeyRows from "../timeline/KeyRows.svelte";
	import KeyRowsToggle from "../timeline/KeyRowsToggle.svelte";
	import { clipAt } from "../../timeline/clips";
	import { effectFocus } from "../../effects/effect-focus.svelte";
	import {
		chainKeyRows,
		withChainTracks,
		type KeyRow,
		type RowTracks,
	} from "../../timeline/key-rows";
	import ChainClipKeys from "../timeline/ChainClipKeys.svelte";
	import type { EffectInstance } from "../../effects/types";
	import type { ChainClip } from "../../editor/chain-clip";
	import { updateClipsIn } from "../../timeline/clips";
	import LoadFailed from "../ui/LoadFailed.svelte";
	import { getTimelineStack } from "../../editor/timeline-stack.svelte";
	import { latestCopy, markCopied } from "../../editor/copy-stamp";
	import type { Preset } from "../../effects";
	import type { ChainMode } from "../../editor/sequence";
	import { ClipLaneController } from "../../timeline/clip-lane-controller.svelte";
	import {
		copyTextClips,
		createTextClip,
		lyricsDraftFromTimeline,
		pasteTextClips,
		pasteTextOnto,
		splitTextClipAt,
		type TextClip,
		type TextClipboardEntry,
		type TextLane,
		type TextTimeline,
	} from "../../text";
	import type { LyricsSyncProps } from "./LyricsSyncModal.svelte";
	import { lazy } from "../../lazy";
	import { stackIndex, type LayerRef } from "../../timeline/layer-order";
	import ChainClipBar from "../timeline/ChainClipBar.svelte";
	import ClipBoundaries from "../timeline/ClipBoundaries.svelte";
	import ClipLaneGutter from "../timeline/ClipLaneGutter.svelte";
	import LaneDeleteDialog from "../timeline/LaneDeleteDialog.svelte";

	// Only fetched when the sync modal opens; it reseeds from the timeline each open.
	const loadLyricsSyncModal = lazy(() => import("./LyricsSyncModal.svelte"));

	const LANE_HEIGHT = 30;
	/** A folded lane: clips stay readable, but not at a height that pays for the
	 * text inside. */
	const LANE_FOLDED_HEIGHT = 14;
	const NO_FOLDS: ReadonlySet<string> = new Set();
	/** Below this the label is all ellipsis and no word, so a zoomed-out lyrics lane
	 * reads as noise. */
	const MIN_LABEL_PX = 34;

	interface Props {
		timeline: TextTimeline;
		layerOrder?: LayerRef[];
		/** Starts a row drag that reorders the whole layer stack. The editor owns it. */
		onLaneDragStart?: (laneId: string, e: PointerEvent) => void;
		draggingLaneId?: string | null;
		foldedLaneIds?: ReadonlySet<string>;
		onToggleFold?: (laneId: string) => void;
		selectedClipId?: string | null;
		/** The whole selection. `selectedClipId` stays the primary and is always a member. */
		selectedClipIds?: string[];
		onChange: (timeline: TextTimeline) => void;
		/** Called before a change lands, while the pre-edit state is intact. */
		onBeforeEdit?: (coalesceKey?: string) => void;
		/** Song tempo, for interval clips spaced in beats. 0 = unknown. */
		bpm?: number;
		/** Seconds to the first beat, which dragged keys snap to. */
		beatOffset?: number;
		onSeek?: (time: number) => void;
		/** Lanes whose animated settings show in rows under them. */
		keyRowsOpen?: Set<string>;
		onToggleKeyRows?: (laneId: string) => void;
		/** Where the playhead is, for the clip a lane's setting rows show. */
		playhead?: number;
		/** The clip toolbar's actions, fanned out over the selection. */
		onApplyPreset?: (clipIds: string[], preset: Preset) => void;
		onRoll?: (clipIds: string[]) => void;
		onClear?: (clipIds: string[]) => void;
		onModeChange?: (
			clipIds: string[],
			mode: ChainMode,
			intervalSec?: number,
			intervalBeats?: number | null,
		) => void;
		/** When provided, the header grows a Lyrics button that opens the sync modal. */
		lyricsSync?: LyricsSyncProps | null;
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
		selectedClipIds = $bindable([]),
		onChange,
		onBeforeEdit,
		bpm = 0,
		beatOffset = 0,
		onSeek,
		keyRowsOpen = new Set<string>(),
		onToggleKeyRows,
		playhead = 0,
		onApplyPreset,
		onRoll,
		onClear,
		onModeChange,
		lyricsSync = null,
		lyricsOpen = $bindable(false),
	}: Props = $props();

	/** The clip a lane's setting rows show: the one picked on it, else the one
	 * under the playhead. */
	function rowClip(lane: TextLane) {
		return (
			lane.clips.find((c) => c.id === selectedClipId) ??
			lane.clips.find((c) => selectedClipIds.includes(c.id)) ??
			clipAt(lane, playhead)
		);
	}

	function keyRowsOf(lane: TextLane): KeyRow[] {
		const clip = rowClip(lane);
		return clip ? chainKeyRows(clip) : [];
	}

	function editKeyRows(
		lane: TextLane,
		tracks: RowTracks,
		coalesceKey?: string,
	) {
		const clip = rowClip(lane);
		onBeforeEdit?.(coalesceKey);
		if (!clip) return;
		onChange({
			...timeline,
			lanes: timeline.lanes.map((l) =>
				l.id !== lane.id
					? l
					: {
							...l,
							clips: l.clips.map((c) =>
								c.id === clip.id
									? { ...c, effects: withChainTracks(c.effects, tracks) }
									: c,
							),
						},
			),
		});
	}

	function openKeyRow(lane: TextLane, row: KeyRow) {
		const clip = rowClip(lane);
		if (clip && !selectedClipIds.includes(clip.id)) ctrl.selectOnly(clip.id);
		if (row.instanceId) effectFocus.id = row.instanceId;
	}

	/** A keyframe edit made on a clip's bar. */
	function editClipKeys(
		clipId: string,
		edit: (effects: EffectInstance[]) => EffectInstance[],
		coalesceKey?: string,
	) {
		onBeforeEdit?.(coalesceKey);
		onChange({
			...timeline,
			lanes: updateClipsIn(
				timeline.lanes,
				new Set([clipId]),
				(c: ChainClip) => ({
					...c,
					effects: edit(c.effects),
				}),
			),
		});
	}

	/** What the sync modal opens onto: the lyrics lane as the timeline holds it. */
	let lyricsDraft = $derived(lyricsDraftFromTimeline(timeline));
	/** Stays mounted once opened, so closing it keeps a half-done sync. */
	let lyricsMounted = $state(false);
	$effect(() => {
		if (lyricsOpen) lyricsMounted = true;
	});

	// One axis for the whole stack: zoom, pan and playhead-following live in
	// TimelineStack.
	const stack = getTimelineStack();
	const vp = stack.vp;

	// Selection, drags, scrubbing, split/add/delete and the keyboard: the gestures
	// every clip lane shares.
	const ctrl = new ClipLaneController<TextClip, TextLane>(
		{
			kind: "text",
			defaultClipLength: 6,
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
			createClip: (start, end) => createTextClip(start, end, "TEXT"),
			splitClipAt: splitTextClipAt,
			copy: copySelection,
			paste: pasteClipboard,
		},
		stack,
	);
	$effect(() => ctrl.syncSelection());

	// Rendered in the stack's shared selection bar, like the media lanes'.
	let selectedClips = $derived(ctrl.selectedClips);
	$effect(() => {
		if (selectedClips.length === 0 || !onModeChange) return;
		return stack.registerSelectionBar("text", clipBar);
	});

	/** The chain's label, unless it is the default a fresh clip carries. */
	function chainLabel(clip: TextClip): string | null {
		if (clip.label === "clean" && !clip.modified) return null;
		return clip.modified && clip.mode !== "interval"
			? `${clip.label}*`
			: clip.label;
	}

	// Same shape as the media lane's: a paste goes onto the selection when there is
	// one, otherwise stamps whole clips down at the start marker.
	let clipboard: TextClipboardEntry[] = [];
	/** What the clipboard was copied from, plus every copy stamped since. */
	let copiedIds = new Set<string>();
	/** The copy stamp when the clipboard was last filled; a paste answers only if it
	 * matches. */
	let clipStamp = -1;

	function copySelection(): boolean {
		clipboard = copyTextClips(timeline, selectedClipIds);
		if (clipboard.length === 0) return false;
		copiedIds = new Set(selectedClipIds);
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
			onChange(pasteTextOnto(timeline, selectedClipIds, clipboard));
			return true;
		}
		return pasteClips();
	}

	function pasteClips(): boolean {
		const at = stack.pasteTarget();
		const result = pasteTextClips(
			timeline,
			clipboard,
			at.time,
			stack.trackDuration,
			at.laneId,
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

<div class="text-tl">
	{#each timeline.lanes as lane (lane.id)}
		<div
			class="tl-row"
			class:lifted={draggingLaneId === lane.id}
			class:folded={foldedLaneIds.has(lane.id)}
			style="order: {stackIndex(layerOrder, lane.id)}"
			data-layer-id={lane.id}
			data-lane-kind="text"
		>
			<ClipLaneGutter
				{lane}
				{layerOrder}
				{onLaneDragStart}
				folded={foldedLaneIds.has(lane.id)}
				{onToggleFold}
				onToggleEnabled={() => ctrl.setLane(lane.id, "enabled", !lane.enabled)}
				nameTitle="{lane.name} — click to edit this lane's style and effects."
				onNameClick={() => ctrl.openLane(lane)}
				onRename={(name) => ctrl.setLane(lane.id, "name", name)}
				onDelete={() => ctrl.requestDeleteLane(lane)}
			>
				{#snippet trailing()}
					{#if onToggleKeyRows && keyRowsOf(lane).length > 0}
						<KeyRowsToggle
							open={keyRowsOpen.has(lane.id)}
							onToggle={() => onToggleKeyRows(lane.id)}
						/>
					{/if}
				{/snippet}
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
					{#if left < 100 && left + width > 0}
						<div
							class="clip"
							class:selected={selectedClipIds.includes(clip.id)}
							class:primary={selectedClipIds.length > 1 &&
								clip.id === selectedClipId}
							class:muted={!lane.enabled}
							style="left: {left}%; width: {width}%"
							role="button"
							tabindex="0"
							title={clip.text}
							draggable="false"
							ondragstart={(e) => e.preventDefault()}
							onpointerdown={(e) =>
								ctrl.onClipPointerDown(e, lane.id, clip.id, "move")}
							onkeydown={(e) => ctrl.onClipKeydown(e, clip.id)}
						>
							<span
								class="clip-edge start"
								style="width: {edge}px"
								role="presentation"
								onpointerdown={(e) =>
									ctrl.onClipPointerDown(e, lane.id, clip.id, "start")}
							></span>
							{#if ctrl.clipPx(clip) >= MIN_LABEL_PX}
								<span class="clip-label">
									{clip.text || "—"}
									{#if chainLabel(clip)}
										<span class="clip-chain">{chainLabel(clip)}</span>
									{/if}
								</span>
							{/if}
							<ChainClipKeys
								{clip}
								selected={selectedClipIds.includes(clip.id)}
								summary={!keyRowsOpen.has(lane.id)}
								{bpm}
								{beatOffset}
								{onSeek}
								onEdit={(edit, key) => editClipKeys(clip.id, edit, key)}
							/>
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

				<ClipBoundaries {ctrl} {lane} />
			</div>
		</div>
		{#if keyRowsOpen.has(lane.id)}
			{@const rows = keyRowsOf(lane)}
			{#if rows.length > 0}
				<KeyRows
					{rows}
					order={stackIndex(layerOrder, lane.id)}
					toPct={(t) => vp.toPct(t)}
					viewStart={vp.viewStart}
					viewEnd={vp.viewEnd}
					{bpm}
					{beatOffset}
					onSeek={(t) => onSeek?.(t)}
					onTracks={(tracks, key) => editKeyRows(lane, tracks, key)}
					onOpenRow={(row) => openKeyRow(lane, row)}
				/>
			{/if}
		{/if}
	{/each}

	{#if ctrl.lanePendingDelete}
		<LaneDeleteDialog
			lane={ctrl.lanePendingDelete}
			clipNoun="text clip"
			onConfirm={(id) => ctrl.deleteLane(id)}
			onCancel={() => (ctrl.lanePendingDelete = null)}
		/>
	{/if}

	{#if lyricsSync && lyricsMounted}
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
		{:catch}
			<LoadFailed onclose={() => (lyricsOpen = false)} />
		{/await}
	{/if}
</div>

{#snippet clipBar()}
	<ChainClipBar
		title="Text"
		{selectedClips}
		label={(c) => chainLabel(c as TextClip) ?? "clean"}
		{bpm}
		{onApplyPreset}
		{onRoll}
		{onClear}
		{onModeChange}
	/>
{/snippet}

<style>
	/* The chain rides after the words, dimmer: what it says first, what runs on it
	   second. */
	.clip-chain {
		margin-left: 0.35rem;
		color: var(--mosh);
		opacity: 0.85;
	}

	/* No box of its own: the rows join the layer column their sibling renders into. */
	.text-tl {
		display: contents;
	}
</style>
