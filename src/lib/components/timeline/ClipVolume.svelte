<script lang="ts">
	import { MAX_GAIN } from "../../mix/types";

	/** A selection bar's clip volume: slider and read-out, one width at any value. */
	interface Props {
		/** Linear gain; undefined when the selection disagrees. */
		value: number | undefined;
		onInput: (gain: number) => void;
		onReset: () => void;
	}

	let { value, onInput, onReset }: Props = $props();
</script>

<div class="tl-tool-sep"></div>
<span class="tl-tool-label">Clip volume</span>
<input
	type="range"
	class="clip-gain"
	min="0"
	max={MAX_GAIN}
	step="0.01"
	value={value ?? 1}
	class:mixed={value === undefined}
	title="Volume of the selected clips. Double-click to reset."
	oninput={(e) => onInput(+e.currentTarget.value)}
	ondblclick={onReset}
/>
<span class="tl-tool-label clip-gain-val">
	{value === undefined ? "—" : `${Math.round(value * 100)}%`}
</span>

<style>
	.clip-gain {
		width: 6rem;
		accent-color: var(--live);
	}

	.clip-gain.mixed {
		opacity: 0.5;
	}

	.clip-gain-val {
		min-width: 2.5rem;
	}
</style>
