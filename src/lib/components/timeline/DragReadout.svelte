<script lang="ts">
	import { toBody } from "../../actions/to-body";

	/** What a dragged key is at, by the pointer, for as long as the drag lasts. */
	interface Props {
		x: number;
		y: number;
		text: string;
	}

	let { x, y, text }: Props = $props();
</script>

<div class="drag-readout" use:toBody style="left: {x + 14}px; top: {y - 26}px">
	{text}
</div>

<style>
	.drag-readout {
		position: fixed;
		z-index: 1000;
		padding: 0.15rem 0.4rem;
		font-family: var(--font-mono);
		font-size: 0.65rem;
		font-variant-numeric: tabular-nums;
		white-space: nowrap;
		color: var(--text);
		background: var(--raised);
		border: 1px solid var(--line-strong);
		border-radius: var(--r-1);
		pointer-events: none;
	}
</style>
