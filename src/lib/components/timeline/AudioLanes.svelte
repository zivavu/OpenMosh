<script lang="ts">
	import { Activity, Repeat } from "lucide-svelte";
	import { getTimelineStack } from "../../editor/timeline-stack.svelte";
	import { ClipLaneController } from "../../timeline/clip-lane-controller.svelte";
	import { repeatNote, type MixSegment } from "../../mix/plan";
	import ClipRepeats from "./ClipRepeats.svelte";
	import {
		createAudioClip,
		MAX_GAIN,
		splitAudioClipAt,
		type AudioClip,
		type AudioLane,
	} from "../../mix/types";
	import ClipBoundaries from "./ClipBoundaries.svelte";
	import ClipLaneGutter from "./ClipLaneGutter.svelte";
	import LaneDeleteDialog from "./LaneDeleteDialog.svelte";
	import LaneWaveform from "./LaneWaveform.svelte";

	const LANE_HEIGHT = 30;
	const LANE_FOLDED_HEIGHT = 14;
	const NO_FOLDS: ReadonlySet<string> = new Set();
	const MIN_LABEL_PX = 44;
	const FADES = [0.1, 0.25, 0.5, 1, 2, 5, 10];

	interface Props {
		lanes: AudioLane[];
		selectedClipId?: string | null;
		selectedClipIds?: string[];
		onChange: (lanes: AudioLane[]) => void;
		onBeforeEdit?: (coalesceKey?: string) => void;
		/** The mix, for the waveforms. */
		plan: MixSegment[];
		peaksOf: (sourceId: string) => Float32Array | null;
		version: number;
		sourceName: (sourceId: string | null) => string;
		/** Where each clip's sound starts over, if it does. */
		repeatsOf?: (clip: AudioClip) => number[];
		/** Sits under the layer rows, whatever their stacking. */
		orderBase: number;
		foldedLaneIds?: ReadonlySet<string>;
		onToggleFold?: (laneId: string) => void;
	}

	let {
		lanes,
		selectedClipId = $bindable(null),
		selectedClipIds = $bindable([]),
		onChange,
		onBeforeEdit,
		plan,
		peaksOf,
		version,
		sourceName,
		repeatsOf = () => [],
		orderBase,
		foldedLaneIds = NO_FOLDS,
		onToggleFold,
	}: Props = $props();

	const stack = getTimelineStack();
	const vp = stack.vp;

	const ctrl = new ClipLaneController<AudioClip, AudioLane>(
		{
			kind: "audio",
			defaultClipLength: 4,
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
			createClip: (start, end) => createAudioClip(start, end, null),
			splitClipAt: splitAudioClipAt,
			// Sound comes in as files, never as an empty clip drawn on the lane.
			clipSpanAt: () => null,
			copy: () => false,
			paste: () => false,
		},
		stack,
	);
	$effect(() => ctrl.syncSelection());

	let selectedClips = $derived(ctrl.selectedClips);
	$effect(() => {
		if (selectedClips.length === 0) return;
		return stack.registerSelectionBar("audio", clipBar);
	});

	function common<T>(values: T[]): T | undefined {
		return values.every((v) => v === values[0]) ? values[0] : undefined;
	}

	let allLoop = $derived(selectedClips.every((c) => c.loop));
	let commonGain = $derived(common(selectedClips.map((c) => c.gain ?? 1)));
	let commonFadeIn = $derived(
		common(selectedClips.map((c) => c.fadeInSec ?? 0)),
	);
	let commonFadeOut = $derived(
		common(selectedClips.map((c) => c.fadeOutSec ?? 0)),
	);

	function updateSelected(
		fn: (clip: AudioClip) => AudioClip,
		coalesceKey?: string,
	) {
		const ids = new Set(selectedClipIds);
		onBeforeEdit?.(coalesceKey);
		onChange(
			lanes.map((l) =>
				l.clips.some((c) => ids.has(c.id))
					? { ...l, clips: l.clips.map((c) => (ids.has(c.id) ? fn(c) : c)) }
					: l,
			),
		);
	}

	function segmentsOf(laneId: string): MixSegment[] {
		return plan.filter((s) => s.laneId === laneId);
	}

	function clipLabel(clip: AudioClip): string {
		const gain = clip.gain ?? 1;
		const name = sourceName(clip.sourceId);
		return gain === 1 ? name : `${name} · ${Math.round(gain * 100)}%`;
	}
</script>

<svelte:window onkeydown={(e) => ctrl.onKeyDown(e)} />

<div class="audio-tl">
	{#each lanes as lane, i (lane.id)}
		<div
			class="tl-row audio-row"
			class:folded={foldedLaneIds.has(lane.id)}
			style="order: {orderBase + i}"
			data-layer-id={lane.id}
		>
			<ClipLaneGutter
				{lane}
				layerOrder={[]}
				folded={foldedLaneIds.has(lane.id)}
				{onToggleFold}
				eyeTitles={["Mute this lane", "Unmute this lane"]}
				eyeIcon="sound"
				onToggleEnabled={() => ctrl.setLane(lane.id, "enabled", !lane.enabled)}
				nameTitle="{lane.name} — sound only. Double-click to rename."
				onNameClick={() => {
					const first = lane.clips[0];
					if (first) ctrl.selectOnly(first.id);
				}}
				onRename={(name) => ctrl.setLane(lane.id, "name", name)}
				onDelete={() => ctrl.requestDeleteLane(lane)}
			>
				<button
					class="lane-drives"
					class:on={lane.drives}
					aria-pressed={lane.drives}
					title={lane.drives
						? "Drives the effects: audio links follow this lane. Click to stop."
						: "Doesn't drive the effects. Click to let audio links follow this lane."}
					onclick={() => ctrl.setLane(lane.id, "drives", !lane.drives)}
				>
					<Activity size={12} />
				</button>
			</ClipLaneGutter>

			<div
				class="tl-lane lane-track"
				use:ctrl.laneTrack={lane.id}
				style={foldedLaneIds.has(lane.id)
					? `min-height: ${LANE_FOLDED_HEIGHT}px`
					: `height: ${LANE_HEIGHT}px`}
				role="group"
				aria-label="{lane.name} clips"
				onpointerdown={(e) => ctrl.onLanePointerDown(e, lane.id)}
				onpointermove={(e) => ctrl.onPointerMove(e)}
				onpointerup={(e) => ctrl.onPointerUp(e)}
				onpointercancel={(e) => ctrl.onPointerUp(e)}
			>
				{#each lane.clips as clip (clip.id)}
					{const left = $derived(vp.toPct(clip.start))}
					{const width = $derived(vp.toPct(clip.end) - left)}
					{const edge = $derived(ctrl.edgeWidth(clip))}
					{const repeats = $derived(repeatsOf(clip))}
					{#if left < 100 && left + width > 0}
						<div
							class="clip"
							class:selected={selectedClipIds.includes(clip.id)}
							class:primary={selectedClipIds.length > 1 &&
								clip.id === selectedClipId}
							class:muted={!lane.enabled}
							class:orphan={!clip.sourceId}
							style="left: {left}%; width: {width}%"
							role="button"
							tabindex="0"
							title="{clipLabel(clip)}{repeatNote(repeats)}"
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
							<ClipRepeats {clip} times={repeats} px={ctrl.clipPx(clip)} />
							{#if ctrl.clipPx(clip) >= MIN_LABEL_PX}
								<span class="clip-label">{clipLabel(clip)}</span>
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

				{#if !foldedLaneIds.has(lane.id)}
					<LaneWaveform segments={segmentsOf(lane.id)} {peaksOf} {version} />
				{/if}

				<ClipBoundaries {ctrl} {lane} />
			</div>
		</div>
	{/each}

	{#if ctrl.lanePendingDelete}
		<LaneDeleteDialog
			lane={ctrl.lanePendingDelete}
			clipNoun="audio clip"
			onConfirm={(id) => ctrl.deleteLane(id)}
			onCancel={() => (ctrl.lanePendingDelete = null)}
		/>
	{/if}
</div>

{#snippet clipBar()}
	<!-- Can outlive the selection by a frame, while the bar is being taken down. -->
	{#if selectedClips.length > 0}
		<div class="audio-bar">
			<span class="audio-title">Audio</span>
			<span class="tl-tool-label">
				{selectedClips.length > 1
					? `${selectedClips.length} clips`
					: clipLabel(selectedClips[0])}
			</span>
			<div class="tl-tool-sep"></div>
			<span class="tl-tool-label">Clip volume</span>
			<input
				type="range"
				class="audio-gain"
				min="0"
				max={MAX_GAIN}
				step="0.01"
				value={commonGain ?? 1}
				class:mixed={commonGain === undefined}
				title="Volume of the selected clips. Double-click to reset."
				oninput={(e) => {
					const v = +e.currentTarget.value;
					updateSelected(
						(c) => ({ ...c, gain: v === 1 ? undefined : v }),
						`audio-gain-${selectedClipIds.join(",")}`,
					);
				}}
				ondblclick={() => updateSelected((c) => ({ ...c, gain: undefined }))}
			/>
			<span class="tl-tool-label audio-val">
				{commonGain === undefined ? "—" : `${Math.round(commonGain * 100)}%`}
			</span>
			<div class="tl-tool-sep"></div>
			<button
				class="tl-tool-btn"
				class:active={allLoop}
				aria-pressed={allLoop}
				title={allLoop
					? "Looping: the sound starts over when it runs out. Click to play it once."
					: "Loop: start the sound over when it runs out, then drag the clip's end out as far as you want"}
				onclick={() => {
					const loop = !allLoop;
					updateSelected((c) => ({ ...c, loop: loop || undefined }));
				}}
			>
				<Repeat size={12} /> Loop
			</button>
			<div class="tl-tool-sep"></div>
			{#each [["Fade in", "fadeInSec", commonFadeIn], ["Fade out", "fadeOutSec", commonFadeOut]] as const as [label, key, value] (key)}
				<span class="tl-tool-label">{label}</span>
				<select
					class="audio-select"
					value={value === undefined ? "" : String(value)}
					onchange={(e) => {
						const v = e.currentTarget.value;
						if (v === "") return;
						const sec = Number(v);
						updateSelected((c) => ({ ...c, [key]: sec > 0 ? sec : undefined }));
					}}
				>
					{#if value === undefined}
						<option value="" disabled>—</option>
					{/if}
					<option value="0">none</option>
					{#each FADES as sec}
						<option value={String(sec)}>{sec}s</option>
					{/each}
				</select>
			{/each}
		</div>
	{/if}
{/snippet}

<style>
	.audio-tl {
		display: contents;
	}

	/* Mint: sound, set apart from the layers' blue and the effects' violet. */
	.audio-row {
		--clip-accent: var(--live);
		--clip-accent-dim: var(--live-dim);
		--clip-bg: #173029;
		--clip-fg: var(--live);
	}

	.clip.orphan {
		border-style: dashed;
		opacity: 0.6;
	}

	.audio-row .lane-drives {
		color: var(--text-4);
	}

	.lane-drives:hover {
		color: var(--text);
	}

	.lane-drives.on {
		color: var(--mosh);
	}

	.audio-bar {
		flex: 1;
		min-width: 0;
		display: flex;
		align-items: center;
		justify-content: center;
		gap: 0.35rem;
		padding: 0 0.25rem;
	}

	.audio-title {
		font-size: 0.68rem;
		font-weight: 600;
		color: var(--live);
		white-space: nowrap;
	}

	.audio-gain {
		width: 6rem;
		accent-color: var(--live);
	}

	.audio-gain.mixed {
		opacity: 0.5;
	}

	.audio-val {
		min-width: 2.5rem;
	}

	.audio-select {
		padding: 0.15rem 0.25rem;
		border: 1px solid var(--line);
		border-radius: 4px;
		background: var(--surface);
		color: var(--text-2);
		font-size: 0.65rem;
		font-family: inherit;
	}
</style>
