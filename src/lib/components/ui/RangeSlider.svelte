<script lang="ts">
	interface Props {
		value: number;
		min: number;
		max: number;
		step?: number;
		/** Exponent (>1) for a non-linear slider: low end of [min, max] spans more of the track. */
		curve?: number;
		id?: string;
		disabled?: boolean;
		oninput?: (value: number) => void;
		ondblclick?: () => void;
	}

	let {
		value = $bindable(),
		min,
		max,
		step = 1,
		curve = 1,
		id,
		disabled,
		oninput,
		ondblclick,
	}: Props = $props();

	const TRACK_STEPS = 1000;

	function valueToTrack(v: number): number {
		if (curve === 1 || max === min) return ((v - min) / (max - min)) * TRACK_STEPS;
		const t = Math.pow((v - min) / (max - min), 1 / curve);
		return t * TRACK_STEPS;
	}

	function trackToValue(t: number): number {
		const frac = t / TRACK_STEPS;
		const eased = curve === 1 ? frac : Math.pow(frac, curve);
		const raw = min + eased * (max - min);
		return Math.round(raw / step) * step;
	}

	let trackValue = $state(valueToTrack(value));
	$effect(() => {
		trackValue = valueToTrack(value);
	});
</script>

{#if curve === 1}
	<input
		{id}
		type="range"
		{min}
		{max}
		{step}
		{disabled}
		bind:value
		oninput={(e) => oninput?.(+(e.currentTarget as HTMLInputElement).value)}
		{ondblclick}
	/>
{:else}
	<input
		{id}
		type="range"
		min="0"
		max={TRACK_STEPS}
		step="1"
		{disabled}
		bind:value={trackValue}
		oninput={(e) => {
			const v = trackToValue(+(e.currentTarget as HTMLInputElement).value);
			value = v;
			oninput?.(v);
		}}
		{ondblclick}
	/>
{/if}

<style>
	input[type='range'] {
		flex: 1;
		width: 0;
		min-width: 0;
		height: 3px;
		appearance: none;
		-webkit-appearance: none;
		background: var(--sunken);
		box-shadow: inset 0 0 0 1px var(--line);
		border-radius: 2px;
		outline: none;
		cursor: pointer;
	}

	input[type='range']::-webkit-slider-thumb {
		appearance: none;
		-webkit-appearance: none;
		width: 9px;
		height: 13px;
		border-radius: 4px;
		background: var(--text-2);
		cursor: pointer;
		transition: background var(--t-fast);
	}

	input[type='range']::-webkit-slider-thumb:hover {
		background: var(--text);
	}

	input[type='range']::-moz-range-thumb {
		width: 9px;
		height: 13px;
		border-radius: 4px;
		background: var(--text-2);
		border: none;
		cursor: pointer;
		transition: background var(--t-fast);
	}

	input[type='range']::-moz-range-thumb:hover {
		background: var(--text);
	}

	@media (max-width: 800px) {
		input[type='range']::-webkit-slider-thumb {
			width: 14px;
			height: 20px;
		}

		input[type='range']::-moz-range-thumb {
			width: 14px;
			height: 20px;
		}
	}
</style>
