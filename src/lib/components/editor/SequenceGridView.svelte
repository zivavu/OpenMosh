<script lang="ts">
	import { ImageOff, Play, Plus, X } from 'lucide-svelte';
	import {
		SOURCE_DND_TYPE,
		shortSourceName,
		sourceColor,
	} from '../../editor/sequence-source-ui';
	import type { SequenceSource } from '../../editor/sequence-sources.svelte';
	import MediaLightbox from '../ui/MediaLightbox.svelte';

	interface Props {
		sources: SequenceSource[];
		/** Segments with no source of their own play this one. */
		primarySourceId?: string | null;
		/** How many segments are selected — a click assigns to all of them. */
		selectedCount?: number;
		/** Highlights the card the selection currently plays; null when they
		 * disagree. */
		selectedSourceId?: string | null;
		onAddFiles: (files: File[]) => void;
		onRemove: (id: string) => void;
		onReorder: (from: number, to: number) => void;
		onAssign: (sourceId: string) => void;
	}

	let {
		sources,
		primarySourceId = null,
		selectedCount = 0,
		selectedSourceId = null,
		onAddFiles,
		onRemove,
		onReorder,
		onAssign,
	}: Props = $props();

	let fileInput = $state<HTMLInputElement | null>(null);
	let dragFromIndex = $state<number | null>(null);
	let dragOverIndex = $state<number | null>(null);
	let lightboxIndex = $state<number | null>(null);
	let lightboxOrigin = $state({ x: 0, y: 0 });

	let assignable = $derived(selectedCount > 0);

	let lightboxItems = $derived(
		sources.map((s) => ({
			name: s.name,
			kind: s.kind,
			objectUrl: s.objectUrl,
		})),
	);

	/** One dragstart serves both drops: a card carries its index for a reorder
	 * here, and its id under our own type so the timeline below can take the
	 * same drag as an assignment. */
	function onCardDragStart(e: DragEvent, index: number) {
		dragFromIndex = index;
		if (!e.dataTransfer) return;
		e.dataTransfer.effectAllowed = 'copyMove';
		e.dataTransfer.setData(SOURCE_DND_TYPE, sources[index].id);
		// Some browsers cancel a drag that carries no standard data at all.
		e.dataTransfer.setData('text/plain', sources[index].id);
	}

	/**
	 * Which edge of card `i` the insertion line belongs on, or null.
	 *
	 * reorder() splices out then back in, so a card moved rightwards lands
	 * *after* the one it was dropped on and a card moved leftwards lands before
	 * it. A line always on the leading edge would point at the wrong gap for
	 * half of every drag.
	 */
	function dropEdge(i: number): 'before' | 'after' | null {
		if (dragFromIndex === null || dragOverIndex !== i || dragFromIndex === i) {
			return null;
		}
		return dragFromIndex < i ? 'after' : 'before';
	}

	function endCardDrag() {
		dragFromIndex = null;
		dragOverIndex = null;
	}

	// Files dropped anywhere in here are the editor pane's to handle — it already
	// routes a drop to the pool in sequence mode, and taking them here as well
	// would add every file twice.
	function onGridDragOver(e: DragEvent) {
		if (dragFromIndex !== null) e.preventDefault();
	}

	function onGridDrop(e: DragEvent) {
		if (dragFromIndex === null) return;
		e.preventDefault();
		if (dragOverIndex !== null) onReorder(dragFromIndex, dragOverIndex);
		endCardDrag();
	}

	function openLightbox(e: MouseEvent, index: number) {
		const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
		lightboxOrigin = {
			x: rect.left + rect.width / 2 - window.innerWidth / 2,
			y: rect.top + rect.height / 2 - window.innerHeight / 2,
		};
		lightboxIndex = index;
	}

	function onInputChange(e: Event) {
		const input = e.currentTarget as HTMLInputElement;
		const picked = Array.from(input.files ?? []);
		if (picked.length > 0) onAddFiles(picked);
		input.value = '';
	}
</script>

<!-- svelte-ignore a11y_no_static_element_interactions -->
<div class="grid-view" ondragover={onGridDragOver} ondrop={onGridDrop}>
	<input
		bind:this={fileInput}
		type="file"
		accept="image/*,video/*"
		multiple
		hidden
		onchange={onInputChange}
	/>

	<div class="grid-head">
		<span class="grid-hint">
			{#if assignable}
				CLICK A SOURCE TO PLAY IT ON {selectedCount > 1
					? `${selectedCount} SEGMENTS`
					: 'THE SELECTED SEGMENT'}
			{:else}
				DRAG A SOURCE ONTO A SEGMENT, OR SELECT SEGMENTS FIRST
			{/if}
		</span>
	</div>

	{#if sources.length === 0}
		<div class="empty-state">
			<span class="empty-label">NO MEDIA</span>
			<p>Drop images or videos in, or use the button below.</p>
			<button class="add-btn" onclick={() => fileInput?.click()}>
				<Plus size={14} /> ADD MEDIA
			</button>
		</div>
	{:else}
		<div class="grid">
			{#each sources as src, i (src.id)}
				{@const edge = dropEdge(i)}
				<div
					class="card"
					class:active={selectedSourceId === src.id}
					class:assignable
					class:dragging={dragFromIndex === i}
					class:drop-before={edge === 'before'}
					class:drop-after={edge === 'after'}
					role="button"
					tabindex="0"
					draggable="true"
					title={assignable
						? `Play "${src.name}" on the selected segment${selectedCount > 1 ? 's' : ''}, or drag it onto one. Double-click to preview.`
						: `${src.name}. Click to preview, or drag it onto a segment.`}
					ondragstart={(e) => onCardDragStart(e, i)}
					ondragover={(e) => {
						if (dragFromIndex === null) return;
						e.preventDefault();
						dragOverIndex = i;
					}}
					ondragend={endCardDrag}
					onclick={(e) => {
						if (assignable) onAssign(src.id);
						else openLightbox(e, i);
					}}
					ondblclick={(e) => openLightbox(e, i)}
					onkeydown={(e) => {
						if (e.key !== 'Enter' && e.key !== ' ') return;
						e.preventDefault();
						if (assignable) onAssign(src.id);
					}}
				>
					{#if src.thumbUrl}
						<img
							class="card-thumb"
							src={src.thumbUrl}
							alt=""
							loading="lazy"
							decoding="async"
							draggable="false"
						/>
					{:else if src.thumbPending}
						<div class="thumb-loading"></div>
					{:else}
						<div class="thumb-none" title="No preview — the media still works">
							<ImageOff size={14} />
						</div>
					{/if}
					<span
						class="card-index"
						style:border-left="3px solid {sourceColor(i + 1)}"
					>
						{i + 1}
					</span>
					{#if src.kind === 'video'}
						<span class="card-kind" title="Video">
							<Play size={9} fill="currentColor" />
						</span>
					{/if}
					{#if src.id === primarySourceId}
						<span class="card-base" title="Segments with no source of their own play this one">BASE</span>
					{/if}
					<span class="card-name">{shortSourceName(src.name, 20)}</span>
					<button
						class="card-remove"
						title="Remove from the pool"
						onclick={(e) => {
							e.stopPropagation();
							onRemove(src.id);
						}}
					>
						<X size={12} />
					</button>
				</div>
			{/each}

			<button
				class="add-card"
				title="Add images or videos to the pool"
				onclick={() => fileInput?.click()}
			>
				<Plus size={20} />
			</button>
		</div>
	{/if}

	{#if lightboxIndex !== null}
		<MediaLightbox
			items={lightboxItems}
			bind:index={lightboxIndex}
			origin={lightboxOrigin}
			onClose={() => (lightboxIndex = null)}
		/>
	{/if}
</div>

<style>
	.grid-view {
		flex: 1;
		min-height: 0;
		overflow-y: auto;
		padding: 0.9rem 1rem 1.2rem;
		background: var(--ink);
	}

	.grid-head {
		display: flex;
		align-items: center;
		gap: 0.6rem;
		margin-bottom: 0.7rem;
	}

	.grid-hint {
		color: var(--text-4);
		font-family: var(--font-mono);
		font-size: 0.62rem;
		letter-spacing: 0.1em;
	}

	.empty-state {
		display: flex;
		flex-direction: column;
		align-items: center;
		justify-content: center;
		gap: 0.7rem;
		height: 70%;
		color: var(--text-3);
		font-size: 0.85rem;
		text-align: center;
	}

	.empty-state p {
		margin: 0;
	}

	.empty-label {
		color: var(--mosh);
		font-family: var(--font-mono);
		font-size: 0.62rem;
		letter-spacing: 0.16em;
	}

	.add-btn {
		display: flex;
		align-items: center;
		gap: 0.4rem;
		padding: 0.5rem 0.9rem;
		border: 1px solid var(--line-strong);
		border-radius: var(--r-2);
		background: var(--raised);
		color: var(--text);
		font-family: var(--font-mono);
		font-size: 0.68rem;
		letter-spacing: 0.12em;
		cursor: pointer;
		transition:
			border-color var(--t-fast),
			color var(--t-fast);
	}

	.add-btn:hover {
		border-color: var(--mosh);
		color: var(--mosh);
	}

	.grid {
		display: grid;
		grid-template-columns: repeat(auto-fill, minmax(112px, 1fr));
		gap: 0.5rem;
	}

	.card {
		position: relative;
		aspect-ratio: 1;
		border: 1px solid var(--line);
		border-radius: var(--r-2);
		overflow: hidden;
		background: var(--surface);
		cursor: pointer;
		content-visibility: auto;
		contain-intrinsic-size: 112px 112px;
		transition:
			border-color var(--t-fast),
			opacity var(--t-fast);
	}

	.card:hover {
		border-color: var(--line-strong);
	}

	.card.assignable:hover {
		border-color: var(--mosh);
	}

	.card.active {
		border-color: var(--mosh);
	}

	/* Matches the rail: pointer for the click, grabbing once a drag is on. */
	.card:active,
	.card.dragging {
		cursor: grabbing;
	}

	.card.dragging {
		opacity: 0.4;
	}

	/* A line in the gap the card would land in, rather than a border on the card
	   under the cursor — that read as "this one is selected" instead of "it goes
	   here". Inset rather than in the grid gap: the card clips its overflow. */
	.card.drop-before::after,
	.card.drop-after::after {
		content: '';
		position: absolute;
		inset-block: 0;
		width: 3px;
		background: var(--mosh);
		z-index: 2;
	}

	.card.drop-before::after {
		left: 0;
	}

	.card.drop-after::after {
		right: 0;
	}

	.card-thumb {
		width: 100%;
		height: 100%;
		object-fit: cover;
		display: block;
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
		content: '';
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

	.card-index {
		position: absolute;
		top: 4px;
		left: 4px;
		padding: 0 4px;
		border-radius: 2px;
		background: rgba(0, 0, 0, 0.65);
		color: var(--text);
		font-family: var(--font-mono);
		font-size: 0.62rem;
		line-height: 1.5;
	}

	.card-kind {
		position: absolute;
		top: 4px;
		left: 30px;
		display: flex;
		align-items: center;
		padding: 2px 3px;
		border-radius: 2px;
		background: rgba(0, 0, 0, 0.65);
		color: var(--text-2);
	}

	.card-base {
		position: absolute;
		bottom: 20px;
		left: 4px;
		padding: 0 4px;
		border-radius: 2px;
		background: rgba(0, 0, 0, 0.65);
		color: var(--mosh);
		font-family: var(--font-mono);
		font-size: 0.55rem;
		letter-spacing: 0.1em;
		line-height: 1.6;
	}

	.card-name {
		position: absolute;
		bottom: 0;
		left: 0;
		right: 0;
		padding: 2px 5px;
		background: rgba(0, 0, 0, 0.72);
		color: var(--text-3);
		font-family: var(--font-mono);
		font-size: 0.56rem;
		white-space: nowrap;
		overflow: hidden;
		text-overflow: ellipsis;
	}

	.card-remove {
		position: absolute;
		top: 4px;
		right: 4px;
		display: flex;
		align-items: center;
		justify-content: center;
		width: 20px;
		height: 20px;
		padding: 0;
		border: none;
		border-radius: 2px;
		background: rgba(0, 0, 0, 0.65);
		color: var(--text-2);
		cursor: pointer;
		opacity: 0;
		transition: opacity var(--t-fast);
	}

	.card:hover .card-remove,
	.card-remove:focus-visible {
		opacity: 1;
	}

	.card-remove:hover {
		background: var(--rec);
		color: var(--text);
	}

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
</style>
