<script lang="ts">
	import { stackIndex, type LayerRef } from "../../timeline/layer-order";
	import {
		createFxClip,
		splitFxClipAt,
		type FxClip,
		type FxLane,
	} from "../../editor/fx-lanes";
	import { intervalLabel, type ChainMode } from "../../editor/sequence";
	import { applyChainTo, chainClipboard } from "../../editor/chain-clipboard";
	import {
		copyFxClips,
		pasteFxClips,
		type FxClipboardEntry,
	} from "../../editor/fx-clipboard";
	import { latestCopy } from "../../editor/copy-stamp";
	import { getTimelineStack } from "../../editor/timeline-stack.svelte";
	import { ClipLaneController } from "../../timeline/clip-lane-controller.svelte";
	import { pasteOntoClips } from "../../timeline/clip-clipboard";
	import ChainClipBar from "../timeline/ChainClipBar.svelte";
	import ClipBoundaries from "../timeline/ClipBoundaries.svelte";
	import ClipLaneGutter from "../timeline/ClipLaneGutter.svelte";
	import LaneDeleteDialog from "../timeline/LaneDeleteDialog.svelte";

	const LANE_HEIGHT = 30;
	/** A folded lane: clips stay readable, but not at a height that pays for the text. */
	const LANE_FOLDED_HEIGHT = 14;
	/** Shared so an unfolded panel allocates nothing per instance. */
	const NO_FOLDS: ReadonlySet<string> = new Set();
	/** Below this the label is all ellipsis and no word. */
	const MIN_LABEL_PX = 34;

	interface Props {
		lanes: FxLane[];
		selectedClipId?: string | null;
		/** The whole selection, for toolbar actions that live outside these lanes. */
		selectedClipIds?: string[];
		/** Lane picked by its name in the gutter, for the settings panel. */
		selectedLaneId?: string | null;
		onChange: (lanes: FxLane[]) => void;
		/** Called before a change lands, while the pre-edit state is intact. */
		onBeforeEdit?: (coalesceKey?: string) => void;
		/** Beats per minute, when known: unlocks the beat-spaced re-roll options. */
		bpm?: number;
		onModeChange?: (
			clipIds: string[],
			mode: ChainMode,
			intervalSec?: number,
			intervalBeats?: number | null,
		) => void;
		onRoll?: (clipIds: string[]) => void;
		onClear?: (clipIds: string[]) => void;
		/** Every row of the stack, front first: this lane's place in it. */
		layerOrder?: LayerRef[];
		/** Starts a row drag that reorders the whole stack; the editor owns it. */
		onLaneDragStart?: (laneId: string, e: PointerEvent) => void;
		/** Id of the row being dragged right now, for its lifted look. */
		draggingLaneId?: string | null;
		/** Lanes the user has folded to a strip, by lane id. */
		foldedLaneIds?: ReadonlySet<string>;
		/** Fired when a lane's fold toggle is clicked. */
		onToggleFold?: (laneId: string) => void;
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
		foldedLaneIds = NO_FOLDS,
		onToggleFold,
	}: Props = $props();

	// One axis for the whole stack: zoom, pan and playhead-following live in TimelineStack.
	const stack = getTimelineStack();
	const vp = stack.vp;

	// The gestures every clip lane shares: selection, drags, scrubbing, split/add/delete.
	const ctrl = new ClipLaneController<FxClip, FxLane>(
		{
			kind: "fx",
			defaultClipLength: 6,
			get lanes() {
				return lanes;
			},
			setLanes: (next) => onChange(next),
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
			createClip: createFxClip,
			splitClipAt: splitFxClipAt,
			// The clip's own lane speaks for the panel now.
			onSelectOnly: () => (selectedLaneId = null),
			copy: copySelectedChains,
			paste,
		},
		stack,
	);
	$effect(() => ctrl.syncSelection());

	/** Clicking a lane's name aims the settings panel at it; clicking again hands it back. */
	function toggleLaneSelection(lane: FxLane) {
		if (selectedLaneId === lane.id) {
			selectedLaneId = null;
			return;
		}
		selectedLaneId = lane.id;
		ctrl.deselect();
	}

	// Rendered in the stack's shared selection bar rather than a row of our own.
	let selectedClips = $derived(ctrl.selectedClips);
	$effect(() => {
		if (selectedClips.length === 0 || !onModeChange) return;
		return stack.registerSelectionBar("fx", clipBar);
	});

	let commonFade = $derived.by(() => {
		const fades = selectedClips.map((c) => c.fadeSec ?? 0);
		return fades.every((v) => v === fades[0]) ? fades[0] : undefined;
	});

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

	/** Tooltip for a clip, filled in on hover: counting enabled effects walks the whole chain. */
	function clipTitle(clip: FxClip, label: string): string {
		if (clip.mode === "interval") return `Re-rolls every ${label}`;
		let active = 0;
		for (const e of clip.effects) if (e.enabled) active++;
		return `${label} — ${active} effect${active === 1 ? "" : "s"}`;
	}

	// Two things a Ctrl+C here fills: the chain clipboard and the clip clipboard.

	let clipClipboard = $state<FxClipboardEntry[]>([]);
	/** The copy stamp when the clip clipboard was last filled. */
	let clipClipStamp = -1;
	/** What the clip clipboard was copied from, plus every copy stamped from it since. */
	let copiedIds = new Set<string>();

	function copySelectedChains(): boolean {
		const picked = new Set(selectedClipIds);
		const clips = lanes
			.flatMap((l) => l.clips)
			.filter((c) => picked.has(c.id))
			.sort((a, b) => a.start - b.start);
		if (!chainClipboard.copy(clips)) return false;
		clipClipboard = copyFxClips(lanes, selectedClipIds);
		clipClipStamp = chainClipboard.stamp;
		copiedIds = picked;
		return true;
	}

	/** Onto the selection when there is one; otherwise whole clips at the start marker. */
	function paste(): boolean {
		// Something copied on a lane that shares no chain is the newest: that lane pastes.
		if (latestCopy() > chainClipboard.stamp) return false;
		const ontoSelf =
			selectedClipIds.length > 0 &&
			selectedClipIds.every((id) => copiedIds.has(id));
		if (selectedClipIds.length > 0 && !ontoSelf) return pasteChains();
		return pasteClips();
	}

	/** Stamp the copied clips at the start marker, on the lane last clicked. */
	function pasteClips(): boolean {
		if (clipClipboard.length === 0 || latestCopy() !== clipClipStamp) {
			return false;
		}
		const result = pasteFxClips(
			lanes,
			clipClipboard,
			stack.staticTime,
			stack.trackDuration,
			stack.activeLaneId,
		);
		if (result.clipIds.length === 0) return false;
		onBeforeEdit?.();
		onChange(result.lanes);
		for (const id of result.clipIds) copiedIds.add(id);
		selectedClipIds = result.clipIds;
		selectedClipId = result.clipIds[result.clipIds.length - 1];
		return true;
	}

	/** Paste onto every selected clip; a shorter copy repeats over them. */
	function pasteChains(): boolean {
		if (chainClipboard.clips.length === 0 || selectedClipIds.length === 0) {
			return false;
		}
		onBeforeEdit?.();
		onChange(
			pasteOntoClips<FxClip, FxLane, number>(
				lanes,
				selectedClipIds,
				chainClipboard.clips.map((_, i) => i),
				(c, i) => {
					const chain = chainClipboard.at(i);
					return chain ? applyChainTo(c, chain) : c;
				},
			),
		);
		return true;
	}
</script>

<svelte:window onkeydown={(e) => ctrl.onKeyDown(e)} />

<div class="fx-tl">
	{#each lanes as lane (lane.id)}
		<div
			class="tl-row fx-row"
			class:lifted={draggingLaneId === lane.id}
			class:folded={foldedLaneIds.has(lane.id)}
			style="order: {stackIndex(layerOrder, lane.id)}"
			data-layer-id={lane.id}
		>
			<ClipLaneGutter
				{lane}
				{layerOrder}
				{onLaneDragStart}
				folded={foldedLaneIds.has(lane.id)}
				{onToggleFold}
				eyeTitles={["Mute this lane", "Unmute this lane"]}
				onToggleEnabled={() => ctrl.setLane(lane.id, "enabled", !lane.enabled)}
				nameActive={selectedLaneId === lane.id}
				nameTitle="{lane.name} — runs on everything below it in the stack. Click for its mosh and audio settings."
				onNameClick={() => toggleLaneSelection(lane)}
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
					{const left = $derived(vp.toPct(clip.start))}
					{const width = $derived(vp.toPct(clip.end) - left)}
					{const edge = $derived(ctrl.edgeWidth(clip))}
					{#if left < 100 && left + width > 0}
						{const interval = $derived(clip.mode === "interval")}
						{const label = $derived(
							interval
								? intervalLabel(clip.intervalSec, clip.intervalBeats)
								: clip.modified
									? `${clip.label}*`
									: clip.label,
						)}
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
							onpointerenter={(e) =>
								(e.currentTarget.title = clipTitle(clip, label))}
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
								<span class="clip-label">{label}</span>
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
			clipNoun="effect clip"
			onConfirm={(id) => ctrl.deleteLane(id)}
			onCancel={() => (ctrl.lanePendingDelete = null)}
		/>
	{/if}
</div>

{#snippet clipBar()}
	<ChainClipBar
		title="FX"
		{selectedClips}
		label={(c) => c.label}
		{bpm}
		{onRoll}
		{onClear}
		{onModeChange}
	>
		<div class="tl-tool-sep"></div>
		<span class="tl-tool-label">Fade</span>
		<select
			class="chain-select"
			value={commonFade === undefined ? "" : String(commonFade)}
			title="Ramp this lane's effects in and out at the clip's edges"
			onchange={(e) => {
				const v = e.currentTarget.value;
				if (v !== "") setFade(Number(v));
			}}
		>
			{#if commonFade === undefined}
				<option value="" disabled>—</option>
			{/if}
			<option value="0">none</option>
			{#each [0.1, 0.25, 0.5, 1, 2, 5, 10] as sec}
				<option value={String(sec)}>{sec}s</option>
			{/each}
		</select>
	</ChainClipBar>
{/snippet}

<style>
	/* No box of its own: these rows join the stack column the layer lanes render into. */
	.fx-tl {
		display: contents;
	}

	/* Warmer than the layer lanes' blue: these stack onto the source chain. */
	.fx-row {
		--clip-accent: var(--mosh);
		--clip-accent-dim: var(--mosh-dim);
		--clip-bg: #33264a;
		--clip-fg: var(--mosh);
	}

	/* Dashed, because the chain under it is re-rolled rather than fixed. */
	.clip.interval {
		border-style: dashed;
	}
</style>
