<script lang="ts">
	import { uiPrefs } from "../../ui-prefs.svelte";
	import type { FieldDisplay } from "../../value-field";
	import ValueField from "./ValueField.svelte";

	interface Props {
		min: number;
		max: number;
		step?: number;
		valueLow: number;
		valueHigh: number;
		onChangeLow: (v: number) => void;
		onChangeHigh: (v: number) => void;
		formatValue?: (v: number) => string;
		display?: FieldDisplay;
	}

	let {
		min,
		max,
		step = 1,
		valueLow,
		valueHigh,
		onChangeLow,
		onChangeHigh,
		formatValue,
		display,
	}: Props = $props();

	const range = $derived(max - min || 1);
	const leftPct = $derived(((valueLow - min) / range) * 100);
	const rightPct = $derived(100 - ((valueHigh - min) / range) * 100);

	function handleLow(e: Event & { currentTarget: HTMLInputElement }) {
		const v = parseFloat(e.currentTarget.value);
		if (!Number.isNaN(v)) {
			if (v <= valueHigh) onChangeLow(v);
			else {
				onChangeLow(valueHigh);
				e.currentTarget.value = String(valueHigh);
			}
		}
	}

	function handleHigh(e: Event & { currentTarget: HTMLInputElement }) {
		const v = parseFloat(e.currentTarget.value);
		if (!Number.isNaN(v)) {
			if (v >= valueLow) onChangeHigh(v);
			else {
				onChangeHigh(valueLow);
				e.currentTarget.value = String(valueLow);
			}
		}
	}
</script>

{#if uiPrefs.numberInputs}
	<div class="fields">
		<ValueField
			value={valueLow}
			{min}
			max={valueHigh}
			{step}
			{display}
			label="Minimum"
			onCommit={onChangeLow}
		/>
		<ValueField
			value={valueHigh}
			min={valueLow}
			{max}
			{step}
			{display}
			label="Maximum"
			onCommit={onChangeHigh}
		/>
	</div>
{:else}
	<div class="dual-range">
		<div class="slider-area">
			<div class="track">
				<div class="filled" style="left:{leftPct}%;right:{rightPct}%"></div>
			</div>
			<input
				type="range"
				{min}
				{max}
				{step}
				value={valueLow}
				aria-label="Minimum"
				oninput={handleLow}
				class="thumb thumb-low"
			/>
			<input
				type="range"
				{min}
				{max}
				{step}
				value={valueHigh}
				aria-label="Maximum"
				oninput={handleHigh}
				class="thumb thumb-high"
			/>
		</div>
		<div class="labels">
			<span class="val">{formatValue ? formatValue(valueLow) : valueLow}</span>
			<span class="val">{formatValue ? formatValue(valueHigh) : valueHigh}</span
			>
		</div>
	</div>
{/if}

<style>
	.fields {
		display: flex;
		gap: 0.25rem;
		width: 100%;
	}

	.fields :global(.value-field) {
		flex: 1 1 0;
		margin-left: 0;
	}

	.dual-range {
		width: 100%;
		display: flex;
		flex-direction: column;
	}

	.slider-area {
		position: relative;
		width: 100%;
		height: var(--slider-hit);
		display: flex;
		align-items: center;
	}

	.track {
		position: absolute;
		left: 0;
		right: 0;
		height: 4px;
		background: var(--slider-track);
		border-radius: 2px;
		pointer-events: none;
	}

	.filled {
		position: absolute;
		top: 0;
		bottom: 0;
		background: var(--live);
		border-radius: 2px;
	}

	.thumb {
		position: absolute;
		left: 0;
		width: 100%;
		background: transparent;
		pointer-events: none;
		margin: 0;
		padding: 0;
		height: 3px;
		outline: none;
	}

	.thumb::-webkit-slider-thumb {
		pointer-events: all;
		position: relative;
		z-index: 2;
	}

	.thumb::-moz-range-thumb {
		pointer-events: all;
		position: relative;
		z-index: 2;
	}

	.thumb-high {
		z-index: 1;
	}

	.labels {
		display: flex;
		justify-content: space-between;
		padding-top: 1px;
	}

	.val {
		font-family: var(--font-mono);
		font-size: 0.58rem;
		color: var(--text-3);
		font-variant-numeric: tabular-nums;
	}
</style>
