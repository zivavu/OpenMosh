<script lang="ts">
	import { X } from 'lucide-svelte';
	import type { SequenceSource } from '../../editor/sequence-sources.svelte';

	interface Props {
		source: SequenceSource;
		onClose: () => void;
	}

	let { source, onClose }: Props = $props();

	function onKeydown(e: KeyboardEvent) {
		if (e.key === 'Escape') {
			e.preventDefault();
			e.stopPropagation();
			onClose();
		}
	}

	/** Videos carry dimensions and a length from the add-time probe; images
	 * enter the pool without their pixels being touched, so they have neither. */
	let meta = $derived.by(() => {
		const parts: string[] = [];
		if (source.width && source.height) {
			parts.push(`${source.width}×${source.height}`);
		}
		if (source.duration > 0) parts.push(`${source.duration.toFixed(2)}s`);
		return parts.join(' · ');
	});
</script>

<svelte:window onkeydown={onKeydown} />

<!-- svelte-ignore a11y_no_static_element_interactions -->
<!-- svelte-ignore a11y_click_events_have_key_events -->
<div class="preview-overlay" onclick={onClose}>
	<!-- svelte-ignore a11y_no_static_element_interactions -->
	<div
		class="preview-modal"
		role="dialog"
		aria-modal="true"
		aria-label={source.name}
		tabindex="-1"
		onclick={(e) => e.stopPropagation()}
	>
		<div class="head">
			<span class="name" title={source.name}>{source.name}</span>
			{#if meta}<span class="meta">{meta}</span>{/if}
			<button class="close-btn" onclick={onClose} title="Close (Esc)">
				<X size={14} />
			</button>
		</div>
		{#if source.kind === 'video'}
			<!-- svelte-ignore a11y_media_has_caption -->
			<video
				class="media"
				src={source.objectUrl}
				controls
				autoplay
				loop
				muted
				playsinline
			></video>
		{:else}
			<img class="media" src={source.objectUrl} alt={source.name} />
		{/if}
	</div>
</div>

<style>
	.preview-overlay {
		position: fixed;
		inset: 0;
		z-index: 250;
		display: flex;
		align-items: center;
		justify-content: center;
		padding: 1.5rem;
		background: rgba(0, 0, 0, 0.8);
	}

	.preview-modal {
		display: flex;
		flex-direction: column;
		gap: 0.6rem;
		max-width: min(1100px, 100%);
		max-height: 100%;
		padding: 0.9rem;
		background: #141014;
		border: 1px solid #2e2438;
		border-radius: 10px;
		box-shadow: 0 8px 32px rgba(0, 0, 0, 0.6);
	}

	.head {
		display: flex;
		align-items: center;
		gap: 0.6rem;
	}

	.name {
		flex: 1;
		min-width: 0;
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
		color: #d8b8f8;
		font-size: 0.75rem;
		font-family: monospace;
	}

	.meta {
		color: #7a5f94;
		font-size: 0.68rem;
		font-family: monospace;
		font-variant-numeric: tabular-nums;
		flex-shrink: 0;
	}

	.close-btn {
		display: flex;
		align-items: center;
		justify-content: center;
		padding: 2px;
		border: none;
		border-radius: 4px;
		background: none;
		color: #7a5f94;
		cursor: pointer;
	}

	.close-btn:hover {
		color: #eee;
	}

	/* Fits the viewport on whichever axis runs out first, at natural aspect. */
	.media {
		display: block;
		min-height: 0;
		max-width: 100%;
		max-height: calc(100vh - 7rem);
		object-fit: contain;
		background: #000;
		border-radius: 4px;
	}
</style>
