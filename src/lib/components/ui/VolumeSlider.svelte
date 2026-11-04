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
		flex-shrink: 0;
	}

	.volume-slider.fill {
		flex: 1;
		width: auto;
		min-width: 28px;
	}

	@media (max-width: 800px) {
		.volume-slider {
			display: none;
		}
	}
</style>
