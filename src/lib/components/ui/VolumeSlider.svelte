<script lang="ts">
	/** The one volume slider: the transport's, and every audio lane's. */
	interface Props {
		value: number;
		max?: number;
		/** `fill` takes whatever room its row leaves. */
		fill?: boolean;
		width?: string;
		title?: string;
		ariaLabel?: string;
		oninput: (value: number) => void;
		ondblclick?: () => void;
	}

	let {
		value,
		max = 1,
		fill = false,
		width,
		title,
		ariaLabel,
		oninput,
		ondblclick,
	}: Props = $props();
</script>

<input
	type="range"
	class="volume-slider"
	class:fill
	style:width
	min="0"
	{max}
	step="0.01"
	{value}
	{title}
	aria-label={ariaLabel}
	oninput={(e) => oninput(+e.currentTarget.value)}
	{ondblclick}
/>

<style>
	.volume-slider {
		width: 60px;
		height: 4px;
		appearance: none;
		background: rgba(255, 255, 255, 0.07);
		border-radius: 2px;
		cursor: pointer;
		flex-shrink: 0;
	}

	.volume-slider.fill {
		flex: 1;
		width: auto;
		min-width: 28px;
	}

	.volume-slider::-webkit-slider-thumb {
		appearance: none;
		width: 9px;
		height: 13px;
		border-radius: 4px;
		background: var(--text-2);
		cursor: pointer;
	}
	.volume-slider::-moz-range-thumb {
		width: 9px;
		height: 13px;
		border-radius: 4px;
		background: var(--text-2);
		border: none;
		cursor: pointer;
	}
	.volume-slider:hover::-webkit-slider-thumb {
		background: var(--text);
	}
	.volume-slider:hover::-moz-range-thumb {
		background: var(--text);
	}

	@media (max-width: 800px) {
		.volume-slider {
			display: none;
		}
	}
</style>
