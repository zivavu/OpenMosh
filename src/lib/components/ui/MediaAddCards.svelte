<script lang="ts">
	import { Camera, GalleryHorizontal, Plus, Palette } from "lucide-svelte";

	/** The dashed cards that close a media grid: add, generate, webcam, and in the
	 * editor a saved slideshow. */
	interface Props {
		addTitle?: string;
		recordTitle?: string;
		onAdd: () => void;
		onGenerate: () => void;
		onRecord: () => void;
		onSlideshow?: () => void;
	}

	let {
		addTitle = "Add images or videos to the pool",
		recordTitle = "Record from the webcam into the pool",
		onAdd,
		onGenerate,
		onRecord,
		onSlideshow,
	}: Props = $props();
</script>

<button class="add-card" title={addTitle} onclick={onAdd}>
	<Plus size={20} />
</button>
<button
	class="add-card generate"
	title="Generate images into the pool"
	onclick={onGenerate}
>
	<Palette size={18} />
</button>
<button class="add-card generate" title={recordTitle} onclick={onRecord}>
	<Camera size={18} />
</button>
{#if onSlideshow}
	<button
		class="add-card generate"
		title="Add one of your slideshows to the pool"
		onclick={onSlideshow}
	>
		<GalleryHorizontal size={18} />
	</button>
{/if}

<style>
	.add-card {
		display: flex;
		align-items: center;
		justify-content: center;
		aspect-ratio: 1;
		border: 1px dashed var(--line-strong);
		border-radius: var(--r-2);
		background: none;
		color: var(--text-4);
		cursor: pointer;
		transition:
			border-color var(--t-fast),
			color var(--t-fast);
	}

	.add-card:hover {
		border-color: var(--mosh);
		color: var(--mosh);
	}

	.add-card.generate {
		color: var(--mosh-dim);
	}
</style>
