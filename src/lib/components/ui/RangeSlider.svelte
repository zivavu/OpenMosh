<script lang="ts">
	import { uiPrefs } from "../../ui-prefs.svelte";
	import type { FieldDisplay } from "../../value-field";
	import ValueField from "./ValueField.svelte";

	interface Props {
		value: number;
		min: number;
		max: number;
		step?: number;
		/** Exponent (>1) for a non-linear slider: low end of [min, max] spans more of the track. */
		curve?: number;
		/** How the value reads when typed; the row's read-out hides in favor of the field. */
		display?: FieldDisplay;
		/** Stays a track with number inputs on: a seek bar, where scrubbing is the point. */
		sliderOnly?: boolean;
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
		display,
		sliderOnly = false,
		id,
		disabled,
		oninput,
		ondblclick,
	}: Props = $props();

	const TRACK_STEPS = 1000;

	function valueToTrack(v: number): number {
		if (curve === 1 || max === min)
			return ((v - min) / (max - min)) * TRACK_STEPS;
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

{#if uiPrefs.numberInputs && !sliderOnly}
	<ValueField
		{id}
		{value}
		{min}
		{max}
		{step}
		{display}
		{disabled}
		onCommit={(v) => {
			value = v;
			oninput?.(v);
		}}
	/>
{:else if curve === 1}
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
	input[type="range"] {
		flex: 1;
		width: 0;
		min-width: 0;
	}
</style>
