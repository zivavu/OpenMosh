<script lang="ts">
	import type { SlideshowSlide, SlideshowConfig } from '../slideshow/types';
	import type { Preset } from '../effects';

	interface Props {
		slides: SlideshowSlide[];
		config: SlideshowConfig;
		presets: Preset[];
		onAddFiles: (files: FileList) => void;
		onRemoveSlide: (id: string) => void;
		onReorderSlides: (fromIndex: number, toIndex: number) => void;
		onSetPresetIndex: (slideId: string, presetIndex: number | null) => void;
		onSelectSlide: (slide: SlideshowSlide) => void;
	}

	let {
		slides,
		config,
		presets,
		onAddFiles,
		onRemoveSlide,
		onReorderSlides,
		onSetPresetIndex,
		onSelectSlide,
	}: Props = $props();

	let fileInput: HTMLInputElement;
	let dragging = $state(false);
	let dragFromIndex = $state<number | null>(null);
	let dragOverIndex = $state<number | null>(null);

	const IMAGE_TYPES = ['image/png', 'image/jpeg', 'image/webp', 'image/gif'];

	function onDrop(e: DragEvent) {
		dragging = false;
		if (dragFromIndex !== null && dragOverIndex !== null && dragFromIndex !== dragOverIndex) {
			onReorderSlides(dragFromIndex, dragOverIndex);
		}
		dragFromIndex = null;
		dragOverIndex = null;

		const files = e.dataTransfer?.files;
		if (files && files.length > 0) {
			const hasImages = Array.from(files).some((f) => IMAGE_TYPES.includes(f.type));
			if (hasImages) onAddFiles(files);
		}
	}

	function onDragOver(e: DragEvent) {
		e.preventDefault();
		dragging = true;
	}

	function onDragLeave(e: DragEvent) {
		if (e.currentTarget instanceof HTMLElement && !e.currentTarget.contains(e.relatedTarget as Node)) {
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
</script>

<!-- svelte-ignore a11y_no_static_element_interactions -->
<div
	class="grid-view"
	class:dragging
	ondrop={(e) => { e.preventDefault(); onDrop(e); }}
	ondragover={onDragOver}
	ondragleave={onDragLeave}
>
	<input
		bind:this={fileInput}
		type="file"
		accept="image/png,image/jpeg,image/webp,image/gif"
		multiple
		onchange={onInputChange}
		hidden
	/>

	{#if slides.length === 0}
		<div class="empty-state">
			<p>No images loaded. Drag and drop images here or click the button below.</p>
			<button class="add-btn" onclick={() => fileInput.click()}>Add Images</button>
		</div>
	{:else}
		<div class="grid">
			{#each slides as slide, i (slide.id)}
				<div
					class="slide-card"
					class:drag-over={dragOverIndex === i && dragFromIndex !== null && dragFromIndex !== i}
					draggable="true"
					role="button"
					tabindex="0"
					ondragstart={(e) => onItemDragStart(e, i)}
					ondragover={(e) => onItemDragOver(e, i)}
					ondragend={() => { dragFromIndex = null; dragOverIndex = null; }}
					onclick={() => onSelectSlide(slide)}
					onkeydown={(e) => { if (e.key === 'Enter') onSelectSlide(slide); }}
				>
					<img
						class="slide-thumb"
						src={slide.objectUrl}
						alt="Slide {i + 1}"
						loading="lazy"
					/>
					<div class="slide-index">{i + 1}</div>
					<button
						class="remove-btn"
						title="Remove"
						onclick={(e) => { e.stopPropagation(); onRemoveSlide(slide.id); }}
					>
						<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
							<path d="M18 6L6 18" /><path d="M6 6l12 12" />
						</svg>
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

			<button class="add-card" onclick={() => fileInput.click()} title="Add more images">
				<svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
					<line x1="12" y1="5" x2="12" y2="19" />
					<line x1="5" y1="12" x2="19" y2="12" />
				</svg>
			</button>
		</div>
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
		color: #666;
		font-size: 0.85rem;
	}

	.add-btn {
		padding: 0.5rem 1.5rem;
		border: 1.5px solid #444;
		border-radius: 999px;
		background: transparent;
		color: #ccc;
		font-size: 0.8rem;
		font-weight: 600;
		cursor: pointer;
		font-family: inherit;
	}

	.add-btn:hover {
		border-color: #888;
		color: #fff;
	}

	.grid {
		display: grid;
		grid-template-columns: repeat(auto-fill, minmax(100px, 1fr));
		gap: 0.5rem;
	}

	.slide-card {
		position: relative;
		aspect-ratio: 1;
		border: 1.5px solid #2a2a2a;
		border-radius: 6px;
		overflow: hidden;
		cursor: pointer;
		transition: border-color 0.15s;
	}

	.slide-card:hover {
		border-color: #555;
	}

	.slide-card.drag-over {
		border-color: #888;
		border-style: dashed;
	}

	.slide-thumb {
		width: 100%;
		height: 100%;
		object-fit: cover;
		display: block;
		pointer-events: none;
	}

	.slide-index {
		position: absolute;
		top: 4px;
		left: 4px;
		font-size: 0.65rem;
		font-weight: 700;
		color: #fff;
		background: rgba(0, 0, 0, 0.6);
		padding: 0 4px;
		border-radius: 3px;
		line-height: 1.4;
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
		color: #ccc;
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
		color: #fff;
	}

	.preset-select {
		position: absolute;
		bottom: 0;
		left: 0;
		right: 0;
		padding: 2px 4px;
		border: none;
		background: rgba(0, 0, 0, 0.7);
		color: #ccc;
		font-size: 0.6rem;
		font-family: inherit;
	}

	.add-card {
		aspect-ratio: 1;
		border: 1.5px dashed #333;
		border-radius: 6px;
		background: transparent;
		color: #555;
		cursor: pointer;
		display: flex;
		align-items: center;
		justify-content: center;
		transition: border-color 0.15s, color 0.15s;
	}

	.add-card:hover {
		border-color: #555;
		color: #888;
	}
</style>
