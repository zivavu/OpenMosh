<script lang="ts">
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

	// Only fetched when the sync modal is actually opened; it reseeds itself from
	// the timeline on every open, so mounting it late costs nothing.
	const loadLyricsSyncModal = lazy(() => import("./LyricsSyncModal.svelte"));

	const LANE_HEIGHT = 30;
	/** A folded lane: its clips are still there to read, but not at a height that
	 * pays for the text inside them. A floor, not a height: the strip fills its
	 * row, so the gutter controls never leave slack under it. */
	const LANE_FOLDED_HEIGHT = 14;
	/** Shared so an unfolded panel allocates nothing per instance. */
	const NO_FOLDS: ReadonlySet<string> = new Set();
	/**
	 * Below this the label is all ellipsis and no word — a lane of synced lyrics
	 * zoomed out becomes a row of "P…", which reads as noise rather than as text.
	 * The clip's tooltip still names it.
	 */
	const MIN_LABEL_PX = 34;

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
		/** The whole selection. `selectedClipId` stays the primary — the one
		 * the clip panel edits and the anchor a shift-range extends from — and
		 * is always a member of this list. */
		selectedClipIds?: string[];
		onChange: (timeline: TextTimeline) => void;
		/** Called before a change lands, while the pre-edit state is intact. */
		onBeforeEdit?: (coalesceKey?: string) => void;
		/** Song tempo, for interval clips spaced in beats. 0 = unknown. */
		bpm?: number;
		/** The clip toolbar's actions, fanned out over the selection. Without
		 * `onModeChange` the bar stays hidden — a mode with no chain gestures
		 * (the slideshow) has nothing to put in it. */
		onApplyPreset?: (clipIds: string[], preset: Preset) => void;
		onRoll?: (clipIds: string[]) => void;
		onClear?: (clipIds: string[]) => void;
		onModeChange?: (
			clipIds: string[],
			mode: ChainMode,
			intervalSec?: number,
			intervalBeats?: number | null,
		) => void;
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
		selectedClipIds = $bindable([]),
		onChange,
		onBeforeEdit,
		bpm = 0,
		onApplyPreset,
		onRoll,
		onClear,
		onModeChange,
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

	// Selection, drags, scrubbing, split/add/delete and the keyboard — the
	// gestures every clip lane shares. Reads the props live through the getters.
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

	// ── Clip toolbar ─────────────────────────────────────────────────────────
	// Rendered in the stack's shared selection bar, like the media lanes' — one
	// bar for whichever lane holds the selection, so the stack never resizes.
	let selectedClips = $derived(ctrl.selectedClips);
	$effect(() => {
		if (selectedClips.length === 0 || !onModeChange) return;
		return stack.registerSelectionBar("text", clipBar);
	});

	/** The chain's label, unless it is the default a fresh clip carries — a
	 * row of "clean" says nothing the empty rack doesn't. */
	function chainLabel(clip: TextClip): string | null {
		if (clip.label === "clean" && !clip.modified) return null;
		return clip.modified ? `${clip.label}*` : clip.label;
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

	/** Stamp the copied clips at the start marker, on the lane last clicked,
	 * and leave the copies selected to drag from there. */
	function pasteClips(): boolean {
		const result = pasteTextClips(
			timeline,
			clipboard,
			stack.staticTime,
			stack.trackDuration,
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
			/>

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
	{/each}

	{#if ctrl.lanePendingDelete}
		<LaneDeleteDialog
			lane={ctrl.lanePendingDelete}
			clipNoun="text clip"
			onConfirm={(id) => ctrl.deleteLane(id)}
			onCancel={() => (ctrl.lanePendingDelete = null)}
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
	/* The chain rides after the words, dimmer: what it says first, what runs
	   on it second. */
	.clip-chain {
		margin-left: 0.35rem;
		color: var(--mosh);
		opacity: 0.85;
	}

	/* No box of its own: the rows join the layer column their sibling component
	   renders into, so one `order` per row interleaves the two kinds. */
	.text-tl {
		display: contents;
	}
</style>
