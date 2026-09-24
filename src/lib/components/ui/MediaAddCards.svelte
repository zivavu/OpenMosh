<script lang="ts">
	import { Camera, Plus, Palette } from "lucide-svelte";

	/** The three dashed cards that close a media grid: add, generate, webcam. */
	interface Props {
		recordTitle?: string;
		onAdd: () => void;
		onGenerate: () => void;
		onRecord: () => void;
	}

	let {
		recordTitle = "Record from the webcam into the pool",
		onAdd,
		onGenerate,
		onRecord,
	}: Props = $props();
</script>

<button
	class="add-card"
	title="Add images or videos to the pool"
	onclick={onAdd}
>
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
