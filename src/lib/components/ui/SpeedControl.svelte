<script lang="ts">
	/** Playback-speed slider, shared by the standalone video bar and the timeline
	 * stack's header (where a lane's gutter has no room for it). */
	interface Props {
		speed: number;
		onSpeedChange: (speed: number) => void;
	}

	let { speed, onSpeedChange }: Props = $props();

	let label = $derived((speed >= 1 ? speed.toFixed(1) : speed.toFixed(2)) + '×');

	function onInput(e: Event) {
		// Log₂ slider (−2…2 → 0.25×…4×) so 1× sits at center; snap near center.
		const v = +(e.currentTarget as HTMLInputElement).value;
		onSpeedChange(Math.abs(v) < 0.08 ? 1 : 2 ** v);
	}
</script>

<span class="speed-label">{label}</span>
<input
	type="range"
	class="speed-slider"
	min="-2"
	max="2"
	step="0.05"
	value={Math.log2(speed)}
	oninput={onInput}
	ondblclick={() => onSpeedChange(1)}
	title="Speed: {label} (double-click to reset)"
/>

<style>
	.speed-label {
		font-size: 0.7rem;
		color: #666;
		min-width: 2.2rem;
		text-align: right;
		font-variant-numeric: tabular-nums;
		flex-shrink: 0;
	}

	.speed-slider {
		width: 60px;
		height: 4px;
		appearance: none;
		background: #333;
		border-radius: 2px;
		cursor: pointer;
		flex-shrink: 0;
	}

	.speed-slider::-webkit-slider-thumb {
		appearance: none;
		width: 12px;
		height: 12px;
		border-radius: 50%;
		background: #aaa;
		cursor: pointer;
	}

	.speed-slider::-moz-range-thumb {
		width: 12px;
		height: 12px;
		border-radius: 50%;
		background: #aaa;
		border: none;
		cursor: pointer;
	}

	.speed-slider:hover::-webkit-slider-thumb {
		background: #fff;
	}

	.speed-slider:hover::-moz-range-thumb {
		background: #fff;
	}

	@media (max-width: 800px) {
		.speed-label,
		.speed-slider {
			display: none;
		}
	}
</style>
