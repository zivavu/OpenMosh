<script lang="ts">
	import type { KeyEase } from "../../keyframes";

	/** A key's mark, shaped by how it leaves for the next one: a diamond runs
	 * straight, a circle curves, a square holds. */
	interface Props {
		ease: KeyEase | "mixed" | undefined;
		size?: number;
	}

	let { ease, size = 9 }: Props = $props();
</script>

<svg width={size} height={size} viewBox="0 0 10 10" aria-hidden="true">
	{#if ease === "hold"}
		<rect x="1.5" y="1.5" width="7" height="7" />
	{:else if ease && ease !== "mixed"}
		<circle cx="5" cy="5" r="4" />
	{:else}
		<path d="M5 0.5 9.5 5 5 9.5 0.5 5Z" />
	{/if}
</svg>
