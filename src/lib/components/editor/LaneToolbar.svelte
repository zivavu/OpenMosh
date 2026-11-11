<script lang="ts">
	import {
		ChevronsDownUp,
		ChevronsUpDown,
		MicVocal,
		Plus,
	} from "lucide-svelte";
	import { MAX_FX_LANES } from "../../editor/fx-lanes";
	import { MAX_MEDIA_LANES } from "../../media";
	import { MAX_AUDIO_LANES } from "../../mix/types";
	import NumberField from "../ui/NumberField.svelte";
	import SpeedControl from "../ui/SpeedControl.svelte";

	interface Props {
		/** Text lanes are on; with `lyrics` the sync button shows beside them. */
		text: { lyrics: boolean; lyricsOpen: boolean } | null;
		onAddTextLane: () => void;
		onOpenLyrics: () => void;
		/** Media lanes are on, holding this many. */
		mediaLaneCount: number | null;
		onAddMediaLane: () => void;
		/** An editor project with a length: audio, fx, length and Fit show. */
		project: {
			audioLaneCount: number;
			fxLaneCount: number;
			length: number;
			maxLength: number;
			canFit: boolean;
		} | null;
		onAddAudioFile: () => void;
		onAddAudioLane: () => void;
		onAddFxLane: () => void;
		onLengthChange: (length: number) => void;
		onFit: () => void;
		laneCount: number;
		allFolded: boolean;
		onToggleFolds: () => void;
		/** A single video drives the clock, at this speed. */
		videoSpeed: number | null;
		onSpeedChange: (speed: number) => void;
	}

	let {
		text,
		onAddTextLane,
		onOpenLyrics,
		mediaLaneCount,
		onAddMediaLane,
		project,
		onAddAudioFile,
		onAddAudioLane,
		onAddFxLane,
		onLengthChange,
		onFit,
		laneCount,
		allFolded,
		onToggleFolds,
		videoSpeed,
		onSpeedChange,
	}: Props = $props();
</script>

<!-- Each button names the lane it adds: "+ Lane" read as the same button three times. -->
{#if text}
	<div class="tl-tool-sep"></div>
	<button
		class="tl-tool-btn"
		title="Add a lane of timed text over the frame"
		onclick={onAddTextLane}
	>
		<Plus size={12} /> Text lane
	</button>
	{#if text.lyrics}
		<button
			class="tl-tool-btn"
			class:active={text.lyricsOpen}
			title="Sync lyrics to the song: paste them, then press Space as it plays"
			onclick={onOpenLyrics}
		>
			<MicVocal size={12} /> Lyrics
		</button>
	{/if}
{/if}
<!-- Read bottom to top, the way the frame is built. -->
{#if mediaLaneCount !== null}
	<div class="tl-tool-sep"></div>
	<button
		class="tl-tool-btn"
		disabled={mediaLaneCount >= MAX_MEDIA_LANES}
		title={mediaLaneCount >= MAX_MEDIA_LANES
			? `${MAX_MEDIA_LANES} media lanes is the limit`
			: "Add a lane of images, videos or 3D models from the pool, each clip with its own effects"}
		onclick={onAddMediaLane}
	>
		<Plus size={12} /> Media lane
	</button>
{/if}
{#if project}
	<div class="tl-tool-sep"></div>
	<button
		class="tl-tool-btn"
		disabled={project.audioLaneCount >= MAX_AUDIO_LANES}
		title="Add music, a voice-over or any sound, on a lane of its own from the start marker"
		onclick={onAddAudioFile}
	>
		<Plus size={12} /> Audio file
	</button>
	<button
		class="tl-tool-btn"
		disabled={project.audioLaneCount >= MAX_AUDIO_LANES}
		title="Add an empty audio lane to record your microphone onto, or to paste or drag clips onto"
		onclick={onAddAudioLane}
	>
		<Plus size={12} /> Audio lane
	</button>
	<div class="tl-tool-sep"></div>
	<button
		class="tl-tool-btn"
		disabled={project.fxLaneCount >= MAX_FX_LANES}
		title={project.fxLaneCount >= MAX_FX_LANES
			? `${MAX_FX_LANES} lanes is the limit`
			: "Add a lane of extra effects that run over the whole frame, media lanes included"}
		onclick={onAddFxLane}
	>
		<Plus size={12} /> FX lane
	</button>
{/if}
{#if laneCount > 0}
	<div class="tl-tool-sep"></div>
	<button
		class="tl-tool-btn"
		title={allFolded ? "Unfold every lane" : "Fold every lane to a strip"}
		onclick={onToggleFolds}
	>
		{#if allFolded}
			<ChevronsUpDown size={12} /> Unfold all
		{:else}
			<ChevronsDownUp size={12} /> Fold all
		{/if}
	</button>
{/if}
{#if project}
	<div class="tl-tool-sep"></div>
	<span
		class="tl-tool-label"
		title="How long the project runs. Shorter cuts clips crossing the new end back to it; clips wholly past it are kept for when it grows."
		>Length</span
	>
	<NumberField
		value={Math.round(project.length * 10) / 10}
		min={1}
		max={project.maxLength}
		step={1}
		fineStep={0.1}
		allowEmpty={false}
		unit="duration"
		upTitle="Longer (shift for a tenth of a second)"
		downTitle="Shorter (shift for a tenth of a second)"
		commitOnBlur
		onChange={onLengthChange}
	/>
	<button
		class="tl-tool-btn"
		title="Fit the project to its clips: start where the first one does and end where the last one does"
		disabled={!project.canFit}
		onclick={onFit}
	>
		Fit
	</button>
{/if}
{#if videoSpeed !== null}
	<div class="tl-tool-sep"></div>
	<SpeedControl speed={videoSpeed} {onSpeedChange} />
{/if}
