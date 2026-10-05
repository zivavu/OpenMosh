<script lang="ts">
	import { maskPaint } from "../../effects/mask-paint.svelte";

	/** The pill over the preview while a Mask tool has it: what to do, and Done. */
	let { message }: { message: string } = $props();
</script>

<!-- svelte-ignore a11y_no_static_element_interactions -->
<div class="tool-bar" onpointerdown={(e) => e.stopPropagation()}>
	<span>{message}</span>
	<button type="button" onclick={() => (maskPaint.target = null)}>Done</button>
</div>

<style>
	.tool-bar {
		position: absolute;
		top: 0.6rem;
		left: 50%;
		transform: translateX(-50%);
		display: flex;
		align-items: center;
		gap: 0.6rem;
		padding: 0.3rem 0.35rem 0.3rem 0.75rem;
		border-radius: 999px;
		background: rgba(0, 0, 0, 0.7);
		color: var(--text-2);
		font-size: 0.7rem;
		white-space: nowrap;
		cursor: default;
		z-index: 1;
	}

	.tool-bar button {
		padding: 0.2rem 0.7rem;
		border: 1px solid var(--live-dim);
		border-radius: 999px;
		background: none;
		color: var(--live);
		font: inherit;
		cursor: pointer;
	}
</style>
