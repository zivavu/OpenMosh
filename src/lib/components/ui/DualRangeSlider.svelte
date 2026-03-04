<script lang="ts">
	interface Props {
		min: number;
		max: number;
		step?: number;
		valueLow: number;
		valueHigh: number;
		onChangeLow: (v: number) => void;
		onChangeHigh: (v: number) => void;
		formatValue?: (v: number) => string;
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
			oninput={handleLow}
			class="thumb thumb-low"
		/>
		<input
			type="range"
			{min}
			{max}
			{step}
			value={valueHigh}
			oninput={handleHigh}
			class="thumb thumb-high"
		/>
	</div>
	<div class="labels">
		<span class="val">{formatValue ? formatValue(valueLow) : valueLow}</span>
		<span class="val">{formatValue ? formatValue(valueHigh) : valueHigh}</span>
	</div>
</div>

<style>
	.dual-range {
		width: 100%;
		display: flex;
		flex-direction: column;
	}

	.slider-area {
		position: relative;
		width: 100%;
		height: 18px;
		display: flex;
		align-items: center;
	}

	.track {
		position: absolute;
		left: 0;
		right: 0;
		height: 3px;
		background: #333;
		border-radius: 2px;
		pointer-events: none;
	}

	.filled {
		position: absolute;
		top: 0;
		bottom: 0;
		background: #666;
		border-radius: 2px;
	}

	.thumb {
		position: absolute;
		left: 0;
		width: 100%;
		appearance: none;
		-webkit-appearance: none;
		background: transparent;
		pointer-events: none;
		margin: 0;
		padding: 0;
		height: 3px;
		outline: none;
	}

	.thumb::-webkit-slider-thumb {
		-webkit-appearance: none;
		appearance: none;
		width: 12px;
		height: 12px;
		border-radius: 50%;
		background: #aaa;
		cursor: pointer;
		pointer-events: all;
		position: relative;
		z-index: 2;
		transition: background 0.15s;
	}

	.thumb::-webkit-slider-thumb:hover {
		background: #ddd;
	}

	.thumb::-moz-range-thumb {
		width: 12px;
		height: 12px;
		border-radius: 50%;
		background: #aaa;
		cursor: pointer;
		pointer-events: all;
		border: none;
		position: relative;
		z-index: 2;
		transition: background 0.15s;
	}

	.thumb::-moz-range-thumb:hover {
		background: #ddd;
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
		font-size: 0.6rem;
		color: #777;
		font-variant-numeric: tabular-nums;
	}
</style>
