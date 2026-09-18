<script lang="ts">
	import { DEFAULT_SETTINGS } from "../../editor/settings";
	import type { FreqBand } from "../../effects";
	import { RotateCcw } from "lucide-svelte";
	import BpmControl from "../ui/BpmControl.svelte";
	import RangeSlider from "../ui/RangeSlider.svelte";

	/** Mirrors the per-param Freq row on a linked effect. */
	const BANDS = [
		{ id: "full", label: "Full", title: "Full spectrum (20–16k Hz)" },
		{ id: "low", label: "Low", title: "Low (20–500 Hz)" },
		{ id: "mid", label: "Mid", title: "Mid (500–4000 Hz)" },
		{ id: "high", label: "High", title: "High (4k–16k Hz)" },
	] as const satisfies { id: FreqBand; label: string; title: string }[];

	interface Props {
		moshMin: number;
		moshMax: number;
		randomizeOrder: boolean;
		moshAudioLink: boolean;
		moshAudioLinkStrength: number;
		moshLinkBand: FreqBand;
		audioSmoothing: number;
		audioPunch: number;
		hasAudio: boolean;
		/** Name of the fx lane these settings belong to, when one is selected.
		 * Null = the editor's own settings, which media clips and single mode use. */
		targetLabel?: string | null;
		/** The song's tempo: what auto clips re-roll against in sequence mode,
		 * and what beat-synced effects follow in either mode. */
		showTiming?: boolean;
		bpm?: number;
		bpmDetecting?: boolean;
		hasTrack?: boolean;
		onDetectBpm?: () => void;
		onBpmChange?: (bpm: number) => void;
	}

	let {
		moshMin = $bindable(),
		moshMax = $bindable(),
		randomizeOrder = $bindable(),
		moshAudioLink = $bindable(),
		moshAudioLinkStrength = $bindable(),
		moshLinkBand = $bindable(),
		audioSmoothing = $bindable(),
		audioPunch = $bindable(),
		hasAudio,
		targetLabel = null,
		showTiming = false,
		bpm = 0,
		bpmDetecting = false,
		hasTrack = false,
		onDetectBpm,
		onBpmChange,
	}: Props = $props();

	/**
	 * Double-clicking a row — its label, its slider, its checkbox — puts that
	 * setting back to its default. Bound on the row rather than the control so
	 * the label works too; text fields keep double-click-to-select-a-word.
	 */
	function resetRow(e: MouseEvent, reset: () => void) {
		const t = e.target as HTMLElement | null;
		if (
			t?.closest("button, input[type='number'], input[type='text'], textarea")
		)
			return;
		reset();
	}
</script>

<!-- Whose settings these are: an fx lane's, or (unlabelled) the editor's own. -->
{#snippet head(title: string)}
	<div class="section-head">
		<span class="rack-label">{title}</span>
		{#if title === "Mosh" && targetLabel}
			<span class="scope-name">{targetLabel}</span>
		{/if}
	</div>
{/snippet}

<!-- A setting: label, control, and a reset that shows once the value has
     left its default. Double-clicking the row resets it too. -->
{#snippet row(
	id: string,
	label: string,
	hint: string,
	off: boolean,
	reset: () => void,
	control: import("svelte").Snippet,
)}
	<!-- svelte-ignore a11y_no_static_element_interactions -->
	<div
		class="config-row"
		class:off
		title="{hint} Double-click to reset."
		ondblclick={(e) => resetRow(e, reset)}
	>
		<label for={id}>{label}</label>
		{@render control()}
		<button
			class="reset"
			type="button"
			tabindex={off ? 0 : -1}
			title="Reset to default"
			aria-label="Reset {label}"
			onclick={reset}
		>
			<RotateCcw size={10} />
		</button>
	</div>
{/snippet}

<div class="config-panel">
	{#if showTiming}
		{@render head("Timing")}
		<BpmControl
			id="seq-bpm"
			{bpm}
			onBpmChange={(v) => onBpmChange?.(v)}
			{bpmDetecting}
			{hasTrack}
			{onDetectBpm}
		/>
	{/if}

	{@render head("Mosh")}
	{#snippet minCtl()}
		<RangeSlider
			id="mosh-min"
			bind:value={moshMin}
			min={1}
			max={20}
			step={1}
			oninput={(v) => {
				if (moshMax < v) moshMax = v;
			}}
		/>
		<span class="val">{moshMin}</span>
	{/snippet}
	{@render row(
		"mosh-min",
		"Min effects",
		"The fewest effects a mosh may switch on at once.",
		moshMin !== DEFAULT_SETTINGS.moshMin,
		() => {
			moshMin = DEFAULT_SETTINGS.moshMin;
			if (moshMax < moshMin) moshMax = moshMin;
		},
		minCtl,
	)}
	{#snippet maxCtl()}
		<RangeSlider
			id="mosh-max"
			bind:value={moshMax}
			min={1}
			max={20}
			step={1}
			oninput={(v) => {
				if (moshMin > v) moshMin = v;
			}}
		/>
		<span class="val">{moshMax}</span>
	{/snippet}
	{@render row(
		"mosh-max",
		"Max effects",
		"The most effects a mosh may switch on at once. Each roll picks a count between this and the minimum.",
		moshMax !== DEFAULT_SETTINGS.moshMax,
		() => {
			moshMax = DEFAULT_SETTINGS.moshMax;
			if (moshMin > moshMax) moshMin = moshMax;
		},
		maxCtl,
	)}
	{#snippet shuffleCtl()}
		<input id="mosh-shuffle" type="checkbox" bind:checked={randomizeOrder} />
	{/snippet}
	{@render row(
		"mosh-shuffle",
		"Shuffle order",
		"Let a mosh reorder the chain as well as re-roll it. Order changes the look: a blur before a glitch is not the same as a glitch before a blur.",
		randomizeOrder !== DEFAULT_SETTINGS.randomizeOrder,
		() => (randomizeOrder = DEFAULT_SETTINGS.randomizeOrder),
		shuffleCtl,
	)}

	{#if hasAudio}
		{@render head("Audio links")}
		{#snippet linkCtl()}
			<input
				id="mosh-audio-link"
				type="checkbox"
				bind:checked={moshAudioLink}
			/>
		{/snippet}
		{@render row(
			"mosh-audio-link",
			"Link on mosh",
			"Wire some of the moshed parameters to the track's volume on every roll, so they move with the music.",
			moshAudioLink !== DEFAULT_SETTINGS.moshAudioLink,
			() => (moshAudioLink = DEFAULT_SETTINGS.moshAudioLink),
			linkCtl,
		)}
		{#if moshAudioLink}
			{#snippet strengthCtl()}
				<RangeSlider
					id="mosh-audio-link-strength"
					bind:value={moshAudioLinkStrength}
					min={0}
					max={1}
					step={0.05}
				/>
				<span class="val">{Math.round(moshAudioLinkStrength * 100)}%</span>
			{/snippet}
			{@render row(
				"mosh-audio-link-strength",
				"Strength",
				"How much of the mosh follows the audio. Low links a parameter here and there over a narrow range; high links most of them and swings them across their full range.",
				moshAudioLinkStrength !== DEFAULT_SETTINGS.moshAudioLinkStrength,
				() => (moshAudioLinkStrength = DEFAULT_SETTINGS.moshAudioLinkStrength),
				strengthCtl,
			)}
			{#snippet bandCtl()}
				<div class="band-presets" role="group" aria-label="Link frequency band">
					{#each BANDS as band (band.id)}
						<button
							type="button"
							class="band-btn"
							class:active={moshLinkBand === band.id}
							title={band.title}
							onclick={() => (moshLinkBand = band.id)}>{band.label}</button
						>
					{/each}
				</div>
			{/snippet}
			{@render row(
				"mosh-link-band",
				"Band",
				"Which part of the mix the new links listen to. Low follows the kick and bass, high the hats and air, full the level of everything at once.",
				moshLinkBand !== DEFAULT_SETTINGS.moshLinkBand,
				() => (moshLinkBand = DEFAULT_SETTINGS.moshLinkBand),
				bandCtl,
			)}
		{/if}

		<!-- Not gated on moshAudioLink: these shape every link, hand-made ones too. -->
		{@render head("Audio response")}
		{#snippet smoothCtl()}
			<RangeSlider
				id="audio-smoothing"
				bind:value={audioSmoothing}
				min={0}
				max={1}
				step={0.05}
			/>
			<span class="val">{Math.round(audioSmoothing * 100)}%</span>
		{/snippet}
		{@render row(
			"audio-smoothing",
			"Smoothing",
			"How long an effect takes to ease back down after a hit. The rise is always quick, so this stretches the fall only: higher rides over the gaps between hits, lower snaps back at once and flickers on busy music.",
			audioSmoothing !== DEFAULT_SETTINGS.audioSmoothing,
			() => (audioSmoothing = DEFAULT_SETTINGS.audioSmoothing),
			smoothCtl,
		)}
		{#snippet punchCtl()}
			<RangeSlider
				id="audio-punch"
				bind:value={audioPunch}
				min={0}
				max={1}
				step={0.05}
			/>
			<span class="val">{Math.round(audioPunch * 100)}%</span>
		{/snippet}
		{@render row(
			"audio-punch",
			"Punch",
			"How hard an effect has to be hit before it moves far. Higher leaves it near the bottom until the loud hits land, lower lets the quiet parts move it too and keeps it busy the whole track.",
			audioPunch !== DEFAULT_SETTINGS.audioPunch,
			() => (audioPunch = DEFAULT_SETTINGS.audioPunch),
			punchCtl,
		)}
	{/if}
</div>

<style>
	.config-panel {
		display: flex;
		flex-direction: column;
		gap: 0.3rem;
		padding: 0.5rem 0.75rem 1rem;
		max-width: 100%;
	}

	/* A rack label with a hairline running off it. */
	.section-head {
		display: flex;
		align-items: center;
		gap: 0.6rem;
		margin: 0.85rem 0 0.35rem;
	}

	.section-head:first-child {
		margin-top: 0.35rem;
	}

	.section-head::after {
		content: "";
		flex: 1;
		height: 1px;
		background: var(--line);
	}

	.scope-name {
		font-family: var(--font-mono);
		font-size: 0.62rem;
		color: var(--live);
	}

	.config-row {
		display: flex;
		align-items: center;
		gap: 0.5rem;
		min-height: 26px;
		margin: 0 -0.4rem;
		padding: 0 0.4rem;
		border-radius: var(--r-2);
		font-size: 0.78rem;
		transition: background var(--t-fast);
	}

	.config-row:hover {
		background: rgba(255, 255, 255, 0.03);
	}

	.config-row label {
		min-width: 92px;
		color: var(--text-2);
		font-size: 0.76rem;
		/* The row's double-click resets the setting; without this it also
		   selects the label text. */
		user-select: none;
	}

	.config-row input[type="checkbox"] {
		accent-color: var(--live);
	}

	.val {
		min-width: 2.4em;
		text-align: right;
		color: var(--text-2);
		font-family: var(--font-mono);
		font-size: 0.66rem;
		font-variant-numeric: tabular-nums;
	}

	/* Only there once the value has moved, and only under the pointer. */
	.reset {
		display: flex;
		align-items: center;
		justify-content: center;
		width: 18px;
		height: 18px;
		margin-left: auto;
		padding: 0;
		background: none;
		border: none;
		border-radius: var(--r-1);
		color: var(--text-4);
		cursor: pointer;
		opacity: 0;
		pointer-events: none;
		transition:
			opacity var(--t-fast),
			color var(--t-fast);
	}

	.config-row.off:hover .reset,
	.config-row.off .reset:focus-visible {
		opacity: 1;
		pointer-events: auto;
	}

	.reset:hover {
		color: var(--text);
	}

	.band-presets {
		display: flex;
		flex-wrap: wrap;
		gap: 0.2rem;
	}

	.band-btn {
		padding: 0.1rem 0.5rem;
		font-family: var(--font-mono);
		font-size: 0.58rem;
		letter-spacing: 0.08em;
		text-transform: uppercase;
		color: var(--text-3);
		background: none;
		border: 1px solid var(--line);
		border-radius: var(--r-pill);
		cursor: pointer;
		transition:
			color var(--t-fast),
			border-color var(--t-fast),
			background var(--t-fast);
	}

	.band-btn:hover {
		color: var(--text-2);
		border-color: var(--line-strong);
	}

	.band-btn.active {
		color: var(--live);
		border-color: var(--live-dim);
		background: rgba(110, 231, 192, 0.12);
	}
</style>
