<script lang="ts">
	import { Shuffle, X, Plus, ChevronLeft, ChevronRight } from 'lucide-svelte';
	import type { SlideshowSlide, SlideshowConfig } from '../../slideshow/types';
	import type { Preset } from '../../effects';

	interface Props {
		slides: SlideshowSlide[];
		config: SlideshowConfig;
		presets: Preset[];
		onAddFiles: (files: FileList) => void;
		onRemoveSlide: (id: string) => void;
		onReorderSlides: (fromIndex: number, toIndex: number) => void;
		onShuffleSlides: () => void;
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
		onShuffleSlides,
		onSetPresetIndex,
		onSelectSlide,
	}: Props = $props();

	let fileInput: HTMLInputElement;
	let dragging = $state(false);
	let dragFromIndex = $state<number | null>(null);
	let dragOverIndex = $state<number | null>(null);
	let lightboxIndex = $state<number | null>(null);
	let lightboxOrigin = $state({ x: 0, y: 0 });
	let lightboxClosing = $state(false);
	let lightboxImageEl = $state<HTMLImageElement | null>(null);

	const lightboxOriginStyle = $derived(
		`--lb-ox: ${lightboxOrigin.x}px; --lb-oy: ${lightboxOrigin.y}px`
	);

	$effect(() => {
		if (lightboxIndex !== null && lightboxIndex >= slides.length) {
			lightboxIndex = null;
			lightboxClosing = false;
		}
	});

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

	function openLightbox(e: MouseEvent | KeyboardEvent, index: number) {
		closeVersion++;
		const card = e.currentTarget as HTMLElement;
		const rect = card.getBoundingClientRect();
		lightboxOrigin = {
			x: rect.left + rect.width / 2 - window.innerWidth / 2,
			y: rect.top + rect.height / 2 - window.innerHeight / 2
		};
		lightboxIndex = index;
		lightboxClosing = false;
	}

	let closeVersion = 0;

	function closeLightbox() {
		if (lightboxClosing || lightboxIndex === null) return;
		lightboxClosing = true;
		const version = ++closeVersion;
		lightboxImageEl?.addEventListener(
			'transitionend',
			() => {
				if (closeVersion !== version) return;
				lightboxIndex = null;
				lightboxClosing = false;
			},
			{ once: true }
		);
		setTimeout(() => {
			if (closeVersion !== version) return;
			lightboxIndex = null;
			lightboxClosing = false;
		}, 400);
	}

	function lightboxNext() {
		if (lightboxIndex === null) return;
		closeVersion++;
		lightboxClosing = false;
		lightboxIndex = (lightboxIndex + 1) % slides.length;
	}

	function lightboxPrev() {
		if (lightboxIndex === null) return;
		closeVersion++;
		lightboxClosing = false;
		lightboxIndex = (lightboxIndex - 1 + slides.length) % slides.length;
	}

	function onLightboxKeydown(e: KeyboardEvent) {
		if (lightboxIndex === null) return;
		if (e.key === 'ArrowRight') lightboxNext();
		else if (e.key === 'ArrowLeft') lightboxPrev();
		else if (e.key === 'Escape') closeLightbox();
	}
</script>

<!-- svelte-ignore a11y_no_static_element_interactions -->
<div
	class="grid-view"
	class:dragging
	ondrop={(e) => { e.preventDefault(); onDrop(e); }}
	ondragover={onDragOver}
	ondragleave={onDragLeave}
	onkeydown={onLightboxKeydown}
	tabindex="-1"
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
		<div class="grid-toolbar">
			<button class="toolbar-btn" onclick={onShuffleSlides} title="Shuffle order">
				<Shuffle size={13} />
				Shuffle
			</button>
		</div>
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
					onclick={(e) => openLightbox(e, i)}
					onkeydown={(e) => { if (e.key === 'Enter') openLightbox(e, i); }}
				>
					{#if slide.thumbUrl}
					<img class="slide-thumb" src={slide.thumbUrl} alt="Slide {i + 1}" />
				{/if}
					<div class="slide-index">{i + 1}</div>
					<button
						class="remove-btn"
						title="Remove"
						onclick={(e) => { e.stopPropagation(); onRemoveSlide(slide.id); }}
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

			<button class="add-card" onclick={() => fileInput.click()} title="Add more images">
				<Plus size={24} />
			</button>
		</div>
	{/if}

	{#if lightboxIndex !== null}
		<!-- svelte-ignore a11y_no_static_element_interactions -->
		<div
			class="lb-backdrop"
			class:lb-closing={lightboxClosing}
			onclick={closeLightbox}
			onkeydown={onLightboxKeydown}
		>
			<!-- svelte-ignore a11y_no_static_element_interactions -->
			<div class="lb-content" onclick={(e) => e.stopPropagation()}>
				<div class="lb-topbar">
					<span class="lb-info">
						{lightboxIndex + 1} / {slides.length}&nbsp;·&nbsp;{slides[lightboxIndex].file.name}
					</span>
					<button class="lb-close" onclick={closeLightbox}>
						<X size={14} />
					</button>
				</div>
				<div class="lb-img-wrap">
					<button class="lb-arrow lb-arrow-left" onclick={lightboxPrev} title="Previous">
						<ChevronLeft size={18} />
					</button>
					<img
						bind:this={lightboxImageEl}
						class="lb-img"
						class:lb-closing={lightboxClosing}
						src={slides[lightboxIndex].objectUrl}
						alt="Slide {lightboxIndex + 1}"
						style={lightboxOriginStyle}
					/>
					<button class="lb-arrow lb-arrow-right" onclick={lightboxNext} title="Next">
						<ChevronRight size={18} />
					</button>
				</div>
			</div>
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
		border: 1px solid #333;
		border-radius: 5px;
		color: #666;
		cursor: pointer;
		transition: color 0.15s, border-color 0.15s;
	}

	.toolbar-btn:hover {
		color: #bbb;
		border-color: #555;
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
		content-visibility: auto;
		contain-intrinsic-size: 100px 100px;
		background: #1a1a1a;
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

	/* Lightbox */
	.lb-backdrop {
		position: fixed;
		inset: 0;
		background: rgba(0, 0, 0, 0.85);
		display: flex;
		align-items: center;
		justify-content: center;
		z-index: 100;
		opacity: 1;
		transition: opacity 200ms ease;
	}

	.lb-backdrop.lb-closing {
		opacity: 0;
		pointer-events: none;
	}

	.lb-content {
		display: flex;
		flex-direction: column;
		align-items: center;
		gap: 0.5rem;
		max-width: 90vw;
	}

	.lb-topbar {
		display: flex;
		align-items: center;
		justify-content: space-between;
		width: 100%;
		padding: 0 0.25rem;
	}

	.lb-info {
		font-size: 0.7rem;
		color: #888;
		letter-spacing: 0.03em;
		white-space: nowrap;
		overflow: hidden;
		text-overflow: ellipsis;
		max-width: 80%;
	}

	.lb-close {
		background: none;
		border: none;
		color: #666;
		cursor: pointer;
		padding: 2px;
		display: flex;
		align-items: center;
		justify-content: center;
		transition: color 0.15s;
	}

	.lb-close:hover {
		color: #ccc;
	}

	.lb-img-wrap {
		position: relative;
		display: flex;
		align-items: center;
		justify-content: center;
	}

	.lb-img {
		display: block;
		max-width: 90vw;
		max-height: 82vh;
		object-fit: contain;
		border-radius: 4px;
		--lb-ox: 0px;
		--lb-oy: 0px;
		animation: lb-in 220ms cubic-bezier(0.4, 0, 0.2, 1) forwards;
		transition:
			transform 220ms cubic-bezier(0.4, 0, 0.2, 1),
			opacity 180ms ease;
	}

	@keyframes lb-in {
		from {
			transform: translate(var(--lb-ox), var(--lb-oy)) scale(0.12);
			opacity: 0;
		}
		to {
			transform: translate(0, 0) scale(1);
			opacity: 1;
		}
	}

	.lb-img.lb-closing {
		transform: translate(var(--lb-ox), var(--lb-oy)) scale(0.12);
		opacity: 0;
	}

	.lb-arrow {
		position: absolute;
		top: 50%;
		transform: translateY(-50%);
		background: rgba(0, 0, 0, 0.5);
		border: 1px solid #333;
		border-radius: 50%;
		color: #888;
		width: 36px;
		height: 36px;
		display: flex;
		align-items: center;
		justify-content: center;
		cursor: pointer;
		transition: color 0.15s, background 0.15s;
		z-index: 1;
	}

	.lb-arrow:hover {
		color: #fff;
		background: rgba(0, 0, 0, 0.75);
	}

	.lb-arrow-left {
		left: -48px;
	}

	.lb-arrow-right {
		right: -48px;
	}
</style>
