<script lang="ts">
	import NumberField from "../ui/NumberField.svelte";
	import SettingRow from "./SettingRow.svelte";

	interface Props {
		/** Nothing sets the length (no song, no video), so it's typed in here. */
		durationEditable: boolean;
		duration: number;
		/** The length the export will have, when something else sets it. */
		effectiveDuration: number;
		fps: number;
		onStart: () => void;
	}

	let {
		durationEditable,
		duration = $bindable(),
		effectiveDuration,
		fps = $bindable(),
		onStart,
	}: Props = $props();

	/** Seconds. A ceiling on typos, not a format limit: the encoder has no cap. */
	const MAX_DURATION = 600;
	/** One click for the lengths people actually reach for. */
	const DURATION_PRESETS = [5, 10, 30, 60, 120];
</script>

{#if durationEditable}
	<SettingRow label="Duration" for="rec-duration">
		<NumberField
			id="rec-duration"
			value={duration}
			min={1}
			max={MAX_DURATION}
			step={1}
			fineStep={0.5}
			allowEmpty={false}
			unit="duration"
			upTitle="Longer (shift for half a second)"
			downTitle="Shorter (shift for half a second)"
			onChange={(v) => (duration = v)}
		/>
		<span class="unit">sec</span>
	</SettingRow>
	<div class="presets">
		{#each DURATION_PRESETS as preset (preset)}
			<button
				class="preset"
				class:active={duration === preset}
				onclick={() => (duration = preset)}
			>
				{preset}s
			</button>
		{/each}
	</div>
{:else}
	<SettingRow label="Duration">
		<span class="value">{effectiveDuration.toFixed(1)}s</span>
	</SettingRow>
{/if}
<SettingRow label="FPS" for="rec-fps">
	<select id="rec-fps" bind:value={fps}>
		<option value={15}>15</option>
		<option value={24}>24</option>
		<option value={30}>30</option>
		<option value={60}>60</option>
		<option value={120}>120</option>
	</select>
</SettingRow>
<button class="start" onclick={onStart}>Start Recording</button>

<style>
	.unit {
		font-family: var(--font-mono);
		font-size: 0.62rem;
		letter-spacing: 0.09em;
		text-transform: uppercase;
		color: var(--text-3);
	}

	/* Under the field, aligned past the label so the row still reads as one. */
	.presets {
		display: flex;
		gap: 4px;
		margin: -0.25rem 0 0 calc(72px + 0.5rem);
	}

	.preset {
		padding: 0.15rem 0.4rem;
		background: var(--sunken);
		border: 1px solid var(--line);
		border-radius: var(--r-1);
		color: var(--text-3);
		font-family: var(--font-mono);
		font-size: 0.6rem;
		cursor: pointer;
	}

	.preset:hover {
		color: var(--text);
		border-color: var(--line-strong);
	}

	.preset.active {
		color: var(--live);
		border-color: var(--live-dim);
	}

	.value {
		font-family: var(--font-mono);
		font-size: 0.66rem;
		color: var(--text-2);
		min-width: 20px;
		text-align: right;
		font-variant-numeric: tabular-nums;
	}

	.start {
		margin-top: 0.25rem;
		padding: 0.45rem 1rem;
		border: 1.5px solid var(--rec-dim);
		border-radius: var(--r-2);
		background: rgba(255, 95, 86, 0.1);
		color: var(--rec);
		font-family: var(--font-mono);
		font-size: 0.66rem;
		font-weight: 600;
		letter-spacing: 0.1em;
		text-transform: uppercase;
		cursor: pointer;
		transition:
			background var(--t-fast),
			color var(--t-fast);
	}

	.start:hover {
		background: rgba(255, 95, 86, 0.2);
		color: #ffa8a2;
	}
</style>
