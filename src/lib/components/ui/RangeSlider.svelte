<script lang="ts">
	interface Props {
		value: number;
		min: number;
		max: number;
		step?: number;
		id?: string;
		disabled?: boolean;
		oninput?: (value: number) => void;
		ondblclick?: () => void;
	}

	let { value = $bindable(), min, max, step = 1, id, disabled, oninput, ondblclick }: Props = $props();
</script>

<input
	{id}
	type="range"
	{min}
	{max}
	{step}
	{disabled}
	bind:value
	oninput={(e) => oninput?.(+(e.currentTarget as HTMLInputElement).value)}
	ondblclick={ondblclick}
/>

<style>
	input[type='range'] {
		flex: 1;
		width: 0;
		min-width: 0;
		height: 3px;
		appearance: none;
		-webkit-appearance: none;
		background: #333;
		border-radius: 2px;
		outline: none;
		cursor: pointer;
	}

	input[type='range']::-webkit-slider-thumb {
		appearance: none;
		-webkit-appearance: none;
		width: 10px;
		height: 10px;
		border-radius: 50%;
		background: #aaa;
		cursor: pointer;
		transition: background 0.15s;
	}

	input[type='range']::-webkit-slider-thumb:hover {
		background: #ddd;
	}

	input[type='range']::-moz-range-thumb {
		width: 10px;
		height: 10px;
		border-radius: 50%;
		background: #aaa;
		border: none;
		cursor: pointer;
		transition: background 0.15s;
	}

	input[type='range']::-moz-range-thumb:hover {
		background: #ddd;
	}

	@media (max-width: 800px) {
		input[type='range']::-webkit-slider-thumb {
			width: 18px;
			height: 18px;
		}

		input[type='range']::-moz-range-thumb {
			width: 18px;
			height: 18px;
		}
	}
</style>
