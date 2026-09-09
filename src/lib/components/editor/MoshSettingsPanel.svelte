<script lang="ts">
	import { DEFAULT_SETTINGS } from "../../editor/settings";
	import type { FreqBand } from "../../effects";
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
		 * Null = the editor's own settings, which segments and single mode use. */
		targetLabel?: string | null;
		/** The song's tempo: what AUTO segments re-roll against in sequence mode,
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
{#snippet moshHeading()}
	Mosh settings{#if targetLabel}
		- <span class="scope-name">{targetLabel}</span>{/if}
{/snippet}

<div class="config-panel">
	{#if showTiming}
		<h3 class="panel-title">Timing</h3>
		<BpmControl
			id="seq-bpm"
			{bpm}
			onBpmChange={(v) => onBpmChange?.(v)}
			{bpmDetecting}
			{hasTrack}
			{onDetectBpm}
		/>
		<h3 class="panel-title section-title">{@render moshHeading()}</h3>
	{:else}
		<h3 class="panel-title">{@render moshHeading()}</h3>
	{/if}
	<!-- svelte-ignore a11y_no_static_element_interactions -->
	<div
		class="config-row"
		title="The fewest effects a mosh may switch on at once. Double-click to reset."
		ondblclick={(e) =>
			resetRow(e, () => {
				moshMin = DEFAULT_SETTINGS.moshMin;
				if (moshMax < moshMin) moshMax = moshMin;
			})}
	>
		<label for="mosh-min">Min effects</label>
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
	</div>
	<!-- svelte-ignore a11y_no_static_element_interactions -->
	<div
		class="config-row"
		title="The most effects a mosh may switch on at once. Each roll picks a count between this and the minimum. Double-click to reset."
		ondblclick={(e) =>
			resetRow(e, () => {
				moshMax = DEFAULT_SETTINGS.moshMax;
				if (moshMin > moshMax) moshMin = moshMax;
			})}
	>
		<label for="mosh-max">Max effects</label>
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
	</div>
	<!-- svelte-ignore a11y_no_static_element_interactions -->
	<div
		class="config-row"
		title="Let a mosh reorder the chain as well as re-roll it. Order changes the look — a blur before a glitch is not the same as a glitch before a blur. Double-click to reset."
		ondblclick={(e) =>
			resetRow(e, () => (randomizeOrder = DEFAULT_SETTINGS.randomizeOrder))}
	>
		<label for="mosh-shuffle">Shuffle effects order</label>
		<input id="mosh-shuffle" type="checkbox" bind:checked={randomizeOrder} />
	</div>
	{#if hasAudio}
		<h3 class="panel-title section-title">Random audio links</h3>
		<!-- svelte-ignore a11y_no_static_element_interactions -->
		<div
			class="config-row"
			title="Wire some of the moshed parameters to the track's volume on every roll, so they move with the music. Double-click to reset."
			ondblclick={(e) =>
				resetRow(e, () => (moshAudioLink = DEFAULT_SETTINGS.moshAudioLink))}
		>
			<label for="mosh-audio-link">Link on mosh</label>
			<input
				id="mosh-audio-link"
				type="checkbox"
				bind:checked={moshAudioLink}
			/>
		</div>
	{/if}
	{#if hasAudio && moshAudioLink}
		<!-- svelte-ignore a11y_no_static_element_interactions -->
		<div
			class="config-row"
			title="How much of the mosh follows the audio. Low links a parameter here and there over a narrow range; high links most of them and swings them across their full range. Double-click to reset."
			ondblclick={(e) =>
				resetRow(
					e,
					() =>
						(moshAudioLinkStrength = DEFAULT_SETTINGS.moshAudioLinkStrength),
				)}
		>
			<label for="mosh-audio-link-strength">Strength</label>
			<RangeSlider
				id="mosh-audio-link-strength"
				bind:value={moshAudioLinkStrength}
				min={0}
				max={1}
				step={0.05}
			/>
			<span class="val">{Math.round(moshAudioLinkStrength * 100)}%</span>
		</div>
		<!-- svelte-ignore a11y_no_static_element_interactions -->
		<div
			class="config-row"
			title="Which part of the mix the new links listen to. Low follows the kick and bass, high the hats and air, full the level of everything at once. Double-click to reset."
			ondblclick={(e) =>
				resetRow(e, () => (moshLinkBand = DEFAULT_SETTINGS.moshLinkBand))}
		>
			<span class="row-label">Freq</span>
			<div class="band-presets" role="group" aria-label="Link frequency band">
				{#each BANDS as band}
					<button
						type="button"
						class="band-btn"
						class:active={moshLinkBand === band.id}
						title={band.title}
						onclick={() => (moshLinkBand = band.id)}>{band.label}</button
					>
				{/each}
			</div>
		</div>
	{/if}
	<!-- Not gated on moshAudioLink: these shape every link, hand-made ones too. -->
	{#if hasAudio}
		<h3 class="panel-title section-title">Audio response</h3>
		<!-- svelte-ignore a11y_no_static_element_interactions -->
		<div
			class="config-row"
			title="How long an effect takes to ease back down after a hit. The rise is always quick, so this stretches the fall only — higher rides over the gaps between hits, lower snaps back at once and flickers on busy music. Double-click to reset."
			ondblclick={(e) =>
				resetRow(e, () => (audioSmoothing = DEFAULT_SETTINGS.audioSmoothing))}
		>
			<label for="audio-smoothing">Smoothing</label>
			<RangeSlider
				id="audio-smoothing"
				bind:value={audioSmoothing}
				min={0}
				max={1}
				step={0.05}
			/>
			<span class="val">{Math.round(audioSmoothing * 100)}%</span>
		</div>
		<!-- svelte-ignore a11y_no_static_element_interactions -->
		<div
			class="config-row"
			title="How hard an effect has to be hit before it moves far. Higher leaves it near the bottom until the loud hits land, lower lets the quiet parts move it too and keeps it busy the whole track. Double-click to reset."
			ondblclick={(e) =>
				resetRow(e, () => (audioPunch = DEFAULT_SETTINGS.audioPunch))}
		>
			<label for="audio-punch">Punch</label>
			<RangeSlider
				id="audio-punch"
				bind:value={audioPunch}
				min={0}
				max={1}
				step={0.05}
			/>
			<span class="val">{Math.round(audioPunch * 100)}%</span>
		</div>
	{/if}
</div>

<style>
	.config-panel {
		display: flex;
		flex-direction: column;
		gap: 0.5rem;
		padding: 0.75rem;
		border-bottom: 1px solid var(--line);
		max-width: 100%;
	}

	.section-title {
		margin-top: 0.75rem;
	}

	.scope-name {
		color: var(--live);
	}

	.panel-title {
		font-family: var(--font-mono);
		font-size: 0.62rem;
		font-weight: 600;
		letter-spacing: 0.16em;
		color: var(--text-3);
		text-transform: uppercase;
		margin-bottom: 0.25rem;
	}

	.config-row {
		display: flex;
		align-items: center;
		gap: 0.5rem;
		font-size: 0.78rem;
	}

	.config-row label,
	.config-row .row-label {
		min-width: 84px;
		color: var(--text-3);
		font-family: var(--font-mono);
		font-size: 0.62rem;
		font-weight: 500;
		letter-spacing: 0.09em;
		text-transform: uppercase;
		/* The row's double-click resets the setting; without this it also
         selects the label text. */
		user-select: none;
	}

	.config-row input[type="checkbox"] {
		accent-color: var(--live);
	}

	.val {
		color: var(--text-2);
		font-family: var(--font-mono);
		font-size: 0.66rem;
		font-variant-numeric: tabular-nums;
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
