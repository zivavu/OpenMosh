<script lang="ts">
	import { AudioClipSelection } from "../../editor/audio-clip-selection.svelte";
	import { MAX_GAIN, type AudioLane } from "../../mix/types";
	import { percent } from "../../value-field";
	import Checkbox from "../ui/Checkbox.svelte";
	import RangeSlider from "../ui/RangeSlider.svelte";
	import ClipPanel from "./ClipPanel.svelte";
	import FadeRows from "./FadeRows.svelte";

	/** The sidebar's Audio clip tab: the timeline bar's settings for the selected
	 * audio clips, as rows. */
	interface Props {
		lanes: AudioLane[];
		clipIds: string[];
		/** The clip clicked last, whose values show where the selection disagrees. */
		primaryClipId: string | null;
		onChange: (lanes: AudioLane[]) => void;
		onBeforeEdit?: (coalesceKey?: string) => void;
		sourceName: (sourceId: string | null) => string;
		bpmSourceId?: string | null;
		onSetBpmSource?: (sourceId: string) => void;
		onClose?: () => void;
	}

	let {
		lanes,
		clipIds,
		primaryClipId,
		onChange,
		onBeforeEdit,
		sourceName,
		bpmSourceId = null,
		onSetBpmSource,
		onClose,
	}: Props = $props();

	const selection = new AudioClipSelection({
		get lanes() {
			return lanes;
		},
		get clipIds() {
			return clipIds;
		},
		onChange: (next) => onChange(next),
		onBeforeEdit: (key) => onBeforeEdit?.(key),
	});

	let primary = $derived(
		selection.clips.find((c) => c.id === primaryClipId) ?? selection.clips[0],
	);
	let many = $derived(selection.clips.length > 1);
	let title = $derived(
		selection.lanes.length > 1
			? `${selection.lanes.length} lanes`
			: (selection.lanes[0]?.name ?? ""),
	);
	let laneNoun = $derived(
		selection.lanes.length > 1 ? "these clips' lanes" : "this clip's lane",
	);
	let gainShown = $derived(selection.gain ?? primary?.gain ?? 1);
</script>

<ClipPanel
	open={!!primary}
	emptyText="Select an audio clip to edit it."
	section="clip"
	{title}
	subtitle={many
		? `${selection.clips.length} clips`
		: sourceName(primary?.sourceId ?? null)}
	{onClose}
	closeLabel="Close audio clip"
>
	{#snippet controls()}
		{#if primary}
			{#if many}
				<p class="hint">
					Edits here change all {selection.clips.length} selected clips.
				</p>
			{/if}

			<!-- svelte-ignore a11y_no_static_element_interactions -->
			<div
				class="row"
				title="Volume of the selected clips. Double-click to reset."
				ondblclick={() => selection.resetGain()}
			>
				<label for="ac-gain">Volume</label>
				<RangeSlider
					id="ac-gain"
					value={gainShown}
					min={0}
					max={MAX_GAIN}
					step={0.01}
					oninput={(v) => selection.setGain(v)}
					display={percent}
				/>
				<span class="val">
					{selection.gain === undefined
						? "—"
						: `${Math.round(selection.gain * 100)}%`}
				</span>
			</div>

			<div
				class="row"
				title="Start the sound over when it runs out, then drag the clip's end out as far as you want"
			>
				<label for="ac-loop">Loop</label>
				<Checkbox
					id="ac-loop"
					checked={selection.allLoop}
					indeterminate={selection.someLoop && !selection.allLoop}
					onchange={() => selection.setLoop(!selection.allLoop)}
				/>
			</div>

			{#if selection.sourceId && onSetBpmSource}
				{@const sourceId = selection.sourceId}
				{@const isSource = sourceId === bpmSourceId}
				<div
					class="row"
					title={isSource
						? "The BPM comes from this sound"
						: "Measure the BPM from this sound instead, and time the beat grid by it"}
				>
					<label for="ac-bpm">BPM source</label>
					<!-- Another sound has to take over the BPM, so it can't be switched off here. -->
					<Checkbox
						id="ac-bpm"
						checked={isSource}
						disabled={isSource}
						onchange={() => onSetBpmSource(sourceId)}
					/>
				</div>
			{/if}

			<div
				class="row"
				title={selection.allDrive
					? `Effects react to the sound on ${laneNoun}. Click to stop.`
					: `Let the sound on ${laneNoun} drive the audio links, so effects react to it`}
			>
				<label for="ac-drives">Drives FX</label>
				<Checkbox
					id="ac-drives"
					checked={selection.allDrive}
					indeterminate={selection.someDrive && !selection.allDrive}
					onchange={() => selection.setDrives(!selection.allDrive)}
				/>
			</div>

			<FadeRows
				clip={{
					fadeInSec: selection.fadeInSec ?? primary.fadeInSec,
					fadeOutSec: selection.fadeOutSec ?? primary.fadeOutSec,
				}}
				noun="this sound"
				idPrefix="ac"
				onFade={(edge, sec) => selection.setFade(edge, sec, true)}
			/>
		{/if}
	{/snippet}
</ClipPanel>
