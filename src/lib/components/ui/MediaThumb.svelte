<script lang="ts">
	import { ImageOff } from "lucide-svelte";

	/** A card's picture: the thumbnail, a spinner while one is being made, or
	 * a placeholder when the media has none. Fills whatever positions it. */
	interface Props {
		thumbUrl?: string | null;
		thumbPending?: boolean;
		alt?: string;
	}

	let { thumbUrl = null, thumbPending = false, alt = "" }: Props = $props();
</script>

{#if thumbUrl}
	<img
		class="thumb"
		src={thumbUrl}
		{alt}
		loading="lazy"
		decoding="async"
		draggable="false"
	/>
{:else if thumbPending}
	<div class="thumb-loading"></div>
{:else}
	<div class="thumb-none" title="No preview — the media still works">
		<ImageOff size={14} />
	</div>
{/if}

<style>
	.thumb {
		display: block;
		width: 100%;
		height: 100%;
		object-fit: cover;
		pointer-events: none;
	}

	.thumb-loading,
	.thumb-none {
		position: absolute;
		inset: 0;
		display: flex;
		align-items: center;
		justify-content: center;
	}

	.thumb-none {
		color: var(--text-4);
	}

	.thumb-loading::after {
		content: "";
		width: 14px;
		height: 14px;
		border: 2px solid var(--line);
		border-top-color: var(--text-4);
		border-radius: 50%;
		animation: spin 0.7s linear infinite;
	}

	@keyframes spin {
		to {
			transform: rotate(360deg);
		}
	}
</style>
