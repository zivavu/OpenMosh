<script lang="ts">
	import { Camera, Plus, Shuffle, Sparkles, Trash2 } from "lucide-svelte";

	/** The pool's toolbar: shuffle, the three ways in, clear, and a count.
	 * Shared by the editor's source pool and the slideshow's image pool. */
	interface Props {
		count: number;
		/** What one item is called in the readout: "source", "image". */
		noun?: string;
		/** Label on the webcam button: the editor records, the slideshow snaps. */
		recordLabel?: string;
		/** How many items a shuffle is scoped to; 0 means all of them. */
		shuffleScope?: number;
		shuffleTitle?: string;
		recordTitle?: string;
		onShuffle: () => void;
		onAdd: () => void;
		onGenerate: () => void;
		onRecord: () => void;
		onClear: () => void;
	}

	let {
		count,
		noun = "source",
		recordLabel = "Record",
		shuffleScope = 0,
		shuffleTitle = "Shuffle the pool at random",
		recordTitle = "Record from the webcam into the pool",
		onShuffle,
		onAdd,
		onGenerate,
		onRecord,
		onClear,
	}: Props = $props();
</script>

<div class="pool-actions">
	{#if count > 1}
		<button class="pool-btn" title={shuffleTitle} onclick={onShuffle}>
			<Shuffle size={12} />
			<span class="btn-label">Shuffle</span>
			{#if shuffleScope > 0}
				<span class="btn-scope">{shuffleScope}</span>
			{:else}
				<span class="btn-label">all</span>
			{/if}
		</button>
	{/if}
	{#if count > 0}
		<button
			class="pool-btn"
			title="Add images or videos to the pool"
			onclick={onAdd}
		>
			<Plus size={12} />
			<span class="btn-label">Add media</span>
		</button>
		<button
			class="pool-btn"
			title="Generate images into the pool"
			onclick={onGenerate}
		>
			<Sparkles size={12} />
			<span class="btn-label">Generate</span>
		</button>
		<button class="pool-btn" title={recordTitle} onclick={onRecord}>
			<Camera size={12} />
			<span class="btn-label">{recordLabel}</span>
		</button>
		<button
			class="pool-btn danger"
			title="Remove every {noun} from the pool"
			onclick={onClear}
		>
			<Trash2 size={12} />
		</button>
	{/if}
</div>
<span class="pool-count readout">
	{count}
	{noun}{count === 1 ? "" : "s"}
</span>

<style>
	/* Sits right of whatever shares the bar, against the count. */
	.pool-actions {
		display: flex;
		align-items: center;
		gap: 0.35rem;
		margin-left: auto;
		flex-shrink: 0;
	}

	.pool-btn {
		display: inline-flex;
		align-items: center;
		gap: 0.35rem;
		padding: 0.28rem 0.6rem;
		white-space: nowrap;
		border: 1px solid var(--line);
		border-radius: var(--r-1);
		background: none;
		color: var(--text-3);
		font-family: var(--font-mono);
		font-size: 0.64rem;
		letter-spacing: 0.06em;
		cursor: pointer;
		transition:
			color var(--t-fast),
			border-color var(--t-fast);
	}

	.pool-btn:hover {
		color: var(--text);
		border-color: var(--line-strong);
	}

	.pool-btn.danger:hover {
		color: var(--rec);
		border-color: var(--rec);
	}

	/* The count a shuffle is scoped to survives the label being dropped: it is
	   the part that changes with the selection. */
	.btn-scope {
		color: var(--text-2);
	}

	.pool-count {
		font-size: 0.62rem;
		letter-spacing: 0.1em;
		text-transform: uppercase;
		color: var(--text-3);
		white-space: nowrap;
		flex-shrink: 0;
	}

	/* Below this the bar has no room for words: the buttons keep their icons
	   and lose their labels. Four plus the count against a 340px sidebar needs 1200. */
	@media (max-width: 1200px) {
		.pool-actions {
			gap: 0.25rem;
		}

		.pool-btn {
			padding: 0.28rem 0.45rem;
		}

		.pool-btn .btn-label {
			display: none;
		}
	}

	/* Narrower still, the readout goes too: the pool's size is on the grid a
	   tap away. */
	@media (max-width: 1000px) {
		.pool-count {
			display: none;
		}
	}
</style>
