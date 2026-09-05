<script lang="ts">
	import {
		ImageOff,
		Shuffle,
		X,
		Plus,
		Play,
		TriangleAlert,
		Zap,
	} from 'lucide-svelte';
	import type { SlideshowSlide, SlideshowConfig } from '../../slideshow/types';
	import type { Preset } from '../../effects';
	import { lazy } from '../../lazy';

	// Preview overlay: nothing loads it until a slide is opened.
	const loadMediaLightbox = lazy(() => import('../ui/MediaLightbox.svelte'));

	interface Props {
		slides: SlideshowSlide[];
		config: SlideshowConfig;
		presets: Preset[];
		onAddFiles: (files: FileList) => void;
		onRemoveSlide: (id: string) => void;
		onReorderSlides: (fromIndex: number, toIndex: number) => void;
		onShuffleSlides: () => void;
		onSetPresetIndex: (slideId: string, presetIndex: number | null) => void;
		onRetryProxy: (slideId: string) => void;
	}

	let {
		slides,
		config,
		presets,
		onAddFiles,
		onRemoveSlide,
		onReorderSlides,
		onShuffleSlides,
		onSetPresetIndex,
		onRetryProxy,
	}: Props = $props();

	let fileInput: HTMLInputElement;
	let dragging = $state(false);
	let dragFromIndex = $state<number | null>(null);
	let dragOverIndex = $state<number | null>(null);
	let lightboxIndex = $state<number | null>(null);
	let lightboxOrigin = $state({ x: 0, y: 0 });

	let lightboxItems = $derived(
		slides.map((s) => ({
			name: s.file.name,
			kind: s.kind,
			objectUrl: s.objectUrl,
		})),
	);

	const MEDIA_TYPES = [
		'image/png',
		'image/jpeg',
		'image/webp',
		'image/gif',
		'video/mp4',
		'video/webm',
		'video/quicktime',
	];

	function onDrop(e: DragEvent) {
		dragging = false;
		if (
			dragFromIndex !== null &&
			dragOverIndex !== null &&
			dragFromIndex !== dragOverIndex
		) {
			onReorderSlides(dragFromIndex, dragOverIndex);
		}
		dragFromIndex = null;
		dragOverIndex = null;

		const files = e.dataTransfer?.files;
		if (files && files.length > 0) {
			const hasMedia = Array.from(files).some((f) =>
				MEDIA_TYPES.includes(f.type),
			);
			if (hasMedia) onAddFiles(files);
		}
	}

	function onDragOver(e: DragEvent) {
		e.preventDefault();
		dragging = true;
	}

	function onDragLeave(e: DragEvent) {
		if (
			e.currentTarget instanceof HTMLElement &&
			!e.currentTarget.contains(e.relatedTarget as Node)
		) {
			dragging = false;
		}
	}

	function onItemDragStart(e: DragEvent, index: number) {
		dragFromIndex = index;
		if (e.dataTransfer) {
			e.dataTransfer.effectAllowed = 'move';
		}
	}

	function onItemDragOver(e: DragEvent, index: number) {
		e.preventDefault();
		dragOverIndex = index;
	}

	function onInputChange(e: Event) {
		const input = e.target as HTMLInputElement;
		if (input.files && input.files.length > 0) {
			onAddFiles(input.files);
		}
		input.value = '';
	}

	function openLightbox(e: MouseEvent | KeyboardEvent, index: number) {
		const card = e.currentTarget as HTMLElement;
		const rect = card.getBoundingClientRect();
		lightboxOrigin = {
			x: rect.left + rect.width / 2 - window.innerWidth / 2,
			y: rect.top + rect.height / 2 - window.innerHeight / 2,
		};
		lightboxIndex = index;
	}
</script>

<!-- svelte-ignore a11y_no_static_element_interactions -->
<div
	class="grid-view"
	class:dragging
	ondrop={(e) => {
		e.preventDefault();
		onDrop(e);
	}}
	ondragover={onDragOver}
	ondragleave={onDragLeave}
>
	<input
		bind:this={fileInput}
		type="file"
		accept={MEDIA_TYPES.join(',')}
		multiple
		onchange={onInputChange}
		hidden
	/>

	{#if slides.length === 0}
		<div class="empty-state">
			<p>
				Nothing here yet. Drop images or videos in, or use the button
				below.
			</p>
			<button class="add-btn" onclick={() => fileInput.click()}
				>Add media</button
			>
		</div>
	{:else}
		<div class="grid-toolbar">
			<button
				class="toolbar-btn"
				onclick={onShuffleSlides}
				title="Shuffle order"
			>
				<Shuffle size={13} />
				Shuffle
			</button>
		</div>
		<div class="grid">
			{#each slides as slide, i (slide.id)}
				<div
					class="slide-card"
					class:drag-over={dragOverIndex === i &&
						dragFromIndex !== null &&
						dragFromIndex !== i}
					draggable="true"
					role="button"
					tabindex="0"
					ondragstart={(e) => onItemDragStart(e, i)}
					ondragover={(e) => onItemDragOver(e, i)}
					ondragend={() => {
						dragFromIndex = null;
						dragOverIndex = null;
					}}
					onclick={(e) => openLightbox(e, i)}
					onkeydown={(e) => {
						if (e.key === 'Enter') openLightbox(e, i);
					}}
				>
					{#if slide.thumbUrl}
						<img class="slide-thumb" src={slide.thumbUrl} alt="Slide {i + 1}" />
					{:else if slide.thumbPending}
						<div class="thumb-loading"></div>
					{:else}
						<div class="thumb-none" title="No preview — the media still works">
							<ImageOff size={14} />
						</div>
					{/if}
					<div class="slide-index">{i + 1}</div>
					{#if slide.kind === 'video'}
						<div class="video-badge" title="Video">
							<Play size={10} fill="currentColor" />
						</div>
						{#if slide.proxyPending}
							<div
								class="proxy-badge"
								title={`Optimizing for smooth preview — ${Math.round((slide.proxyProgress ?? 0) * 100)}%`}
							>
								{Math.round((slide.proxyProgress ?? 0) * 100)}%
							</div>
						{:else if slide.proxyFailed}
							<button
								class="proxy-badge warn"
								title="Preview optimization failed — click to retry"
								onclick={(e) => {
									e.stopPropagation();
									onRetryProxy(slide.id);
								}}
							>
								<TriangleAlert size={10} />
							</button>
						{:else if slide.proxyFile}
							<div
								class="proxy-badge ok"
								title="Preview optimized — decodes from a smaller copy"
							>
								<Zap size={10} fill="currentColor" />
							</div>
						{/if}
					{/if}
					<button
						class="remove-btn"
						title="Remove"
						onclick={(e) => {
							e.stopPropagation();
							onRemoveSlide(slide.id);
						}}
					>
						<X size={12} />
					</button>

					{#if config.moshMode === 'per-image'}
						<select
							class="preset-select"
							value={slide.presetIndex ?? ''}
							onchange={(e) => {
								e.stopPropagation();
								const val = (e.currentTarget as HTMLSelectElement).value;
								onSetPresetIndex(slide.id, val === '' ? null : +val);
							}}
							onclick={(e) => e.stopPropagation()}
						>
							<option value="">Default</option>
							{#each presets as preset, pi}
								<option value={pi}>{preset.name}</option>
							{/each}
						</select>
					{/if}
				</div>
			{/each}

			<button
				class="add-card"
				onclick={() => fileInput.click()}
				title="Add more media"
			>
				<Plus size={24} />
			</button>
		</div>
	{/if}

	{#if lightboxIndex !== null}
		{#await loadMediaLightbox() then MediaLightbox}
			<MediaLightbox
				items={lightboxItems}
				bind:index={lightboxIndex}
				origin={lightboxOrigin}
				onClose={() => (lightboxIndex = null)}
			/>
		{/await}
	{/if}
</div>

<style>
	.grid-view {
		flex: 1;
		overflow-y: auto;
		padding: 1rem;
		transition: background-color 0.2s;
	}

	.grid-view.dragging {
		background-color: rgba(255, 255, 255, 0.02);
	}

	.empty-state {
		display: flex;
		flex-direction: column;
		align-items: center;
		justify-content: center;
		height: 100%;
		gap: 1rem;
		color: var(--text-3);
		font-size: 0.85rem;
	}

	.add-btn {
		padding: 0.5rem 1.5rem;
		border: 1.5px solid var(--line-strong);
		border-radius: 999px;
		background: transparent;
		color: var(--text);
		font-size: 0.8rem;
		font-weight: 600;
		cursor: pointer;
		font-family: inherit;
	}

	.add-btn:hover {
		border-color: var(--text-3);
		color: var(--text);
	}

	.grid-toolbar {
		display: flex;
		gap: 0.4rem;
		margin-bottom: 0.6rem;
	}

	.toolbar-btn {
		display: inline-flex;
		align-items: center;
		gap: 0.35rem;
		padding: 0.25rem 0.6rem;
		font-size: 0.65rem;
		font-weight: 600;
		letter-spacing: 0.04em;
		font-family: inherit;
		background: none;
		border: 1px solid var(--line);
		border-radius: 5px;
		color: var(--text-3);
		cursor: pointer;
		transition:
			color 0.15s,
			border-color 0.15s;
	}

	.toolbar-btn:hover {
		color: var(--text-2);
		border-color: var(--text-4);
	}

	.grid {
		display: grid;
		grid-template-columns: repeat(auto-fill, minmax(100px, 1fr));
		gap: 0.5rem;
	}

	.slide-card {
		position: relative;
		aspect-ratio: 1;
		border: 1.5px solid var(--line);
		border-radius: 6px;
		overflow: hidden;
		cursor: pointer;
		transition: border-color 0.15s;
		content-visibility: auto;
		contain-intrinsic-size: 100px 100px;
		background: var(--surface);
	}

	.slide-card:hover {
		border-color: var(--text-4);
	}

	.slide-card.drag-over {
		border-color: var(--text-3);
		border-style: dashed;
	}

	.slide-thumb {
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
		width: 16px;
		height: 16px;
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

	.slide-index {
		position: absolute;
		top: 4px;
		left: 4px;
		font-size: 0.65rem;
		font-weight: 700;
		color: var(--text);
		background: rgba(0, 0, 0, 0.6);
		padding: 0 4px;
		border-radius: 3px;
		line-height: 1.4;
	}

	.video-badge {
		position: absolute;
		bottom: 4px;
		left: 4px;
		display: flex;
		align-items: center;
		justify-content: center;
		color: var(--text);
		background: rgba(0, 0, 0, 0.6);
		padding: 2px 3px;
		border-radius: 3px;
	}

	.proxy-badge {
		position: absolute;
		bottom: 4px;
		left: 30px;
		display: flex;
		align-items: center;
		color: var(--text-3);
		background: rgba(0, 0, 0, 0.6);
		padding: 2px 3px;
		border: none;
		border-radius: 3px;
		font-family: var(--font-mono);
		font-size: 0.55rem;
	}

	button.proxy-badge {
		cursor: pointer;
	}

	.proxy-badge.ok {
		color: var(--live);
	}

	.proxy-badge.warn {
		color: var(--start);
	}

	.remove-btn {
		position: absolute;
		top: 4px;
		right: 4px;
		width: 20px;
		height: 20px;
		border: none;
		border-radius: 3px;
		background: rgba(0, 0, 0, 0.6);
		color: var(--text);
		cursor: pointer;
		display: flex;
		align-items: center;
		justify-content: center;
		opacity: 0;
		transition: opacity 0.15s;
	}

	.slide-card:hover .remove-btn {
		opacity: 1;
	}

	.remove-btn:hover {
		background: rgba(200, 50, 50, 0.8);
		color: var(--text);
	}

	.preset-select {
		position: absolute;
		bottom: 0;
		left: 0;
		right: 0;
		padding: 2px 4px;
		border: none;
		background: rgba(0, 0, 0, 0.7);
		color: var(--text);
		font-size: 0.6rem;
		font-family: inherit;
	}

	.add-card {
		aspect-ratio: 1;
		border: 1.5px dashed var(--line);
		border-radius: 6px;
		background: transparent;
		color: var(--text-4);
		cursor: pointer;
		display: flex;
		align-items: center;
		justify-content: center;
		transition:
			border-color 0.15s,
			color 0.15s;
	}

	.add-card:hover {
		border-color: var(--text-4);
		color: var(--text-3);
	}
</style>
