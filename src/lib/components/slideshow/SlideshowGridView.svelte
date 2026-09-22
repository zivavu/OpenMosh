<script lang="ts">
	import { Camera, X, Play, Sparkles } from "lucide-svelte";
	import type { SlideshowSlide, SlideshowConfig } from "../../slideshow/types";
	import type { Preset } from "../../effects";
	import type { ProxyAction } from "../../video/proxy-status";
	import { lazy } from "../../lazy";
	import { createLightbox } from "../ui/lightbox.svelte";
	import MediaAddCards from "../ui/MediaAddCards.svelte";
	import MediaThumb from "../ui/MediaThumb.svelte";
	import ProxyBadge from "../ui/ProxyBadge.svelte";

	// Preview overlay: nothing loads it until a slide is opened.
	const loadMediaLightbox = lazy(() => import("../ui/MediaLightbox.svelte"));

	interface Props {
		slides: SlideshowSlide[];
		config: SlideshowConfig;
		presets: Preset[];
		onAddFiles: (files: FileList) => void;
		/** Open the image generator, which adds what it makes to the pool. */
		onGenerate: () => void;
		onSnap: () => void;
		onRemoveSlide: (id: string) => void;
		onReorderSlides: (fromIndex: number, toIndex: number) => void;
		onSetPresetIndex: (slideId: string, presetIndex: number | null) => void;
		/** Click on a slide's proxy badge, see proxyStatus's `action`. */
		onProxyAction: (slideId: string, action: ProxyAction["kind"]) => void;
	}

	let {
		slides,
		config,
		presets,
		onAddFiles,
		onGenerate,
		onSnap,
		onRemoveSlide,
		onReorderSlides,
		onSetPresetIndex,
		onProxyAction,
	}: Props = $props();

	let fileInput: HTMLInputElement;
	let dragging = $state(false);
	let dragFromIndex = $state<number | null>(null);
	let dragOverIndex = $state<number | null>(null);
	const lightbox = createLightbox();

	let lightboxItems = $derived(
		slides.map((s) => ({
			name: s.file.name,
			kind: s.kind,
			objectUrl: s.objectUrl,
		})),
	);

	const MEDIA_TYPES = [
		"image/png",
		"image/jpeg",
		"image/webp",
		"image/gif",
		"video/mp4",
		"video/webm",
		"video/quicktime",
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
			e.dataTransfer.effectAllowed = "move";
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
		input.value = "";
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
		accept={MEDIA_TYPES.join(",")}
		multiple
		onchange={onInputChange}
		hidden
	/>

	{#if slides.length === 0}
		<div class="empty-state">
			<p>
				Nothing here yet. Drop images or videos in, or use the button below.
			</p>
			<div class="empty-actions">
				<button class="add-btn" onclick={() => fileInput.click()}
					>Add media</button
				>
				<button class="add-btn generate" onclick={onGenerate}
					><Sparkles size={13} /> Generate</button
				>
				<button class="add-btn generate" onclick={onSnap}
					><Camera size={13} /> Snap</button
				>
			</div>
		</div>
	{:else}
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
					onclick={(e) => lightbox.open(e, i)}
					onkeydown={(e) => {
						if (e.key === "Enter") lightbox.open(e, i);
					}}
				>
					<MediaThumb
						thumbUrl={slide.thumbUrl}
						thumbPending={slide.thumbPending}
						alt="Slide {i + 1}"
					/>
					<div class="slide-index">{i + 1}</div>
					{#if slide.kind === "video"}
						<div class="video-badge" title="Video">
							<Play size={10} fill="currentColor" />
						</div>
						<ProxyBadge
							source={slide}
							size={10}
							onAction={(action) => onProxyAction(slide.id, action)}
						/>
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

					{#if config.moshMode === "per-image"}
						<select
							class="preset-select"
							value={slide.presetIndex ?? ""}
							onchange={(e) => {
								e.stopPropagation();
								const val = (e.currentTarget as HTMLSelectElement).value;
								onSetPresetIndex(slide.id, val === "" ? null : +val);
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

			<MediaAddCards
				recordTitle="Snap webcam stills on the beat"
				onAdd={() => fileInput.click()}
				{onGenerate}
				onRecord={onSnap}
			/>
		</div>
	{/if}

	{#if lightbox.index !== null}
		{#await loadMediaLightbox() then MediaLightbox}
			<MediaLightbox
				items={lightboxItems}
				bind:index={lightbox.index}
				origin={lightbox.origin}
				onClose={lightbox.close}
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

	.slide-card :global(.proxy-badge) {
		position: absolute;
		bottom: 4px;
		left: 30px;
		padding: 2px 3px;
		border-radius: 3px;
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

	.empty-actions {
		display: flex;
		gap: 0.5rem;
		justify-content: center;
	}

	.add-btn.generate {
		display: inline-flex;
		align-items: center;
		gap: 0.35rem;
		color: var(--mosh);
	}
</style>
