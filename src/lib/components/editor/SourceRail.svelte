<script lang="ts">
	import LoadFailed from "../ui/LoadFailed.svelte";
	import {
		Box,
		ChevronDown,
		ChevronUp,
		ImageOff,
		Play,
		Plus,
		SlidersHorizontal,
	} from "lucide-svelte";
	import {
		DEFAULT_SOURCE_EDIT,
		hasAnimation,
		isFullCrop,
		type SourceEdit,
	} from "../../media";
	import { lazy } from "../../lazy";
	import { readRaw, writeRaw } from "../../storage";
	import {
		SOURCE_DND_TYPE,
		shortSourceName,
		sourceColor,
	} from "../../editor/sequence-source-ui";
	import {
		beginSourceDrag,
		endSourceDrag,
	} from "../../editor/source-drag.svelte";
	import {
		lightboxItem,
		type SequenceSource,
	} from "../../editor/sequence-sources.svelte";
	import { createLightbox } from "../ui/lightbox.svelte";
	import ProxyBadge from "../ui/ProxyBadge.svelte";
	import type { ProxyAction } from "../../video/proxy-status";

	// Both are overlays: neither chunk is needed until one is actually opened.
	const loadSourceEditor = lazy(() => import("./SourceEditor.svelte"));
	const loadMediaLightbox = lazy(() => import("../ui/MediaLightbox.svelte"));

	interface Props {
		sources: SequenceSource[];
		/** How many layer clips are selected: Enter on a thumb assigns to all of them. */
		selectedCount?: number;
		/** Marks the thumb the selection currently plays; null when they disagree. */
		selectedSourceId?: string | null;
		onAssign: (sourceId: string) => void;
		onAdd: () => void;
		onRemove?: (sourceId: string) => void;
		/** Drag one thumb onto another to move it there. */
		onReorder?: (from: number, to: number) => void;
		/** Per-source edits, keyed by source id. Sparse: only edited media. */
		edits?: Record<string, SourceEdit>;
		onEditChange?: (sourceId: string, edit: SourceEdit) => void;
		/** Fired as the media edit modal opens and closes. */
		onEditingChange?: (open: boolean) => void;
		/** A video's proxy badge was clicked. */
		onProxyAction?: (sourceId: string, action: ProxyAction["kind"]) => void;
	}

	let {
		sources,
		selectedCount = 0,
		selectedSourceId = null,
		onAssign,
		onAdd,
		onRemove,
		onReorder,
		edits = {},
		onEditChange,
		onEditingChange,
		onProxyAction,
	}: Props = $props();

	const OPEN_KEY = "openmosh-seq-rail-open";
	let open = $state(readRaw(OPEN_KEY) !== "0");

	let assignable = $derived(selectedCount > 0);

	/** Open thumb's index; null when the preview is closed. */
	const lightbox = createLightbox();

	let lightboxItems = $derived(sources.map(lightboxItem));

	/** Source whose editor is open; null when the dialog is closed. */
	let editingId = $state<string | null>(null);
	let editingSource = $derived(sources.find((s) => s.id === editingId) ?? null);

	// Report the modal's state up, so the editor can stop the preview behind it.
	$effect(() => onEditingChange?.(!!editingSource));

	/** Any of the three tools having been used, not just the key. */
	function isEdited(src: SequenceSource): boolean {
		const e = edits[src.id];
		return (
			!!e &&
			(e.chromaKey.enabled ||
				!isFullCrop(e.crop) ||
				!!e.mask ||
				hasAnimation(e))
		);
	}

	function toggle() {
		open = !open;
		writeRaw(OPEN_KEY, open ? "1" : "0");
	}

	/** The scrolling strip, for centring the highlighted thumb. */
	let itemsEl = $state<HTMLDivElement | undefined>(undefined);

	/** Follow the highlight: the rail holds more thumbs than fit. */
	$effect(() => {
		const id = selectedSourceId;
		if (!id || !open) return;
		const strip = itemsEl;
		const el = strip?.querySelector<HTMLElement>(`[data-source-id="${id}"]`);
		if (!strip || !el) return;
		const strips = strip.getBoundingClientRect();
		const item = el.getBoundingClientRect();
		const delta = item.left + item.width / 2 - (strips.left + strips.width / 2);
		if (Math.abs(delta) < 1) return;
		strip.scrollBy({ left: delta, behavior: "smooth" });
	});

	// Reorder, the same gesture the grid's cards use.
	let dragFromIndex = $state<number | null>(null);
	let dragOverIndex = $state<number | null>(null);

	function onThumbDragStart(e: DragEvent, src: SequenceSource, index: number) {
		dragFromIndex = index;
		// So a lane can draw what is coming before the drop hands it over.
		beginSourceDrag(src.id);
		if (!e.dataTransfer) return;
		e.dataTransfer.effectAllowed = "copyMove";
		e.dataTransfer.setData(SOURCE_DND_TYPE, src.id);
		// Some browsers cancel a drag that carries no standard data at all.
		e.dataTransfer.setData("text/plain", src.id);
	}

	/** Which edge of slot `i` the insertion line belongs on. */
	function dropEdge(i: number): "before" | "after" | null {
		if (dragFromIndex === null || dragOverIndex !== i || dragFromIndex === i) {
			return null;
		}
		return dragFromIndex < i ? "after" : "before";
	}

	function endThumbDrag() {
		endSourceDrag();
		dragFromIndex = null;
		dragOverIndex = null;
	}

	function onStripDrop(e: DragEvent) {
		if (dragFromIndex === null) return;
		e.preventDefault();
		if (dragOverIndex !== null && dragOverIndex !== dragFromIndex) {
			onReorder?.(dragFromIndex, dragOverIndex);
		}
		endThumbDrag();
	}
</script>

<div class="rail" class:open>
	<button
		class="rail-toggle"
		onclick={toggle}
		title={open ? "Hide the media rail" : "Show the media rail"}
		aria-expanded={open}
	>
		{#if open}
			<ChevronDown size={11} />
		{:else}
			<ChevronUp size={11} />
		{/if}
		<span class="rail-label">Media</span>
		<span class="rail-count">{sources.length}</span>
	</button>

	{#if open}
		<!-- svelte-ignore a11y_no_static_element_interactions -->
		<div
			class="rail-items"
			bind:this={itemsEl}
			ondragover={(e) => dragFromIndex !== null && e.preventDefault()}
			ondrop={onStripDrop}
		>
			{#each sources as src, i (src.id)}
				{const edge = $derived(dropEdge(i))}
				<div
					class="rail-slot"
					class:dragging={dragFromIndex === i}
					class:drop-before={edge === "before"}
					class:drop-after={edge === "after"}
					data-source-id={src.id}
					ondragover={(e) => {
						if (dragFromIndex === null) return;
						e.preventDefault();
						dragOverIndex = i;
					}}
					ondragend={endThumbDrag}
					role="presentation"
				>
					<button
						class="rail-item"
						class:playing={src.id === selectedSourceId}
						draggable="true"
						ondragstart={(e) => onThumbDragStart(e, src, i)}
						onclick={(e) => lightbox.open(e, i)}
						onkeydown={(e) => {
							if (e.key !== "Enter" || !assignable) return;
							e.preventDefault();
							onAssign(src.id);
						}}
						title={assignable
							? `${src.name} — click to preview. Drag it onto the selected media clip${selectedCount > 1 ? "s" : ""}, or press Enter to show it there.`
							: `${src.name} — click to preview, or drag it onto a media clip`}
					>
						{#if src.thumbUrl}
							<img
								class="rail-thumb"
								src={src.thumbUrl}
								alt=""
								loading="lazy"
								decoding="async"
								draggable="false"
							/>
						{:else}
							<div class="rail-thumb rail-thumb-empty">
								{#if !src.thumbPending}
									<ImageOff size={11} />
								{/if}
							</div>
						{/if}
						<span class="rail-n" style:background={sourceColor(i + 1)}
							>{i + 1}</span
						>
						{#if src.kind === "video"}
							<span class="rail-kind"
								><Play size={7} fill="currentColor" /></span
							>
						{:else if src.kind === "model"}
							<span class="rail-kind" title="3D model"><Box size={7} /></span>
						{/if}
						<span class="rail-name">{shortSourceName(src.name, 10)}</span>
					</button>
					<!-- Beside the chip rather than in it, so it can be a button of its own. -->
					{#if src.kind === "video"}
						<ProxyBadge
							source={src}
							size={7}
							onAction={onProxyAction
								? (action) => onProxyAction(src.id, action)
								: undefined}
						/>
					{/if}
					<!-- Crop, key and erase work on pixels a model doesn't have yet. -->
					{#if onEditChange && src.kind !== "model"}
						<button
							class="rail-edit"
							class:on={isEdited(src)}
							onclick={() => (editingId = src.id)}
							title="Edit “{src.name}” — crop it, erase parts, remove its background"
							aria-label="Edit {src.name}"
						>
							<SlidersHorizontal size={10} />
						</button>
					{/if}
				</div>
			{/each}
			<button
				class="rail-add"
				onclick={onAdd}
				title="Add images, videos or 3D models (OBJ, STL, GLB, FBX, PLY)"
			>
				<Plus size={13} />
			</button>
		</div>
	{/if}
</div>

{#if editingSource && onEditChange}
	{#await loadSourceEditor() then SourceEditor}
		<SourceEditor
			source={editingSource}
			edit={edits[editingSource.id] ?? DEFAULT_SOURCE_EDIT}
			onChange={(edit) => onEditChange(editingSource!.id, edit)}
			onClose={() => (editingId = null)}
		/>
	{:catch}
		<LoadFailed onclose={() => (editingId = null)} />
	{/await}
{/if}

{#if lightbox.index !== null}
	{#await loadMediaLightbox() then MediaLightbox}
		<MediaLightbox
			items={lightboxItems}
			bind:index={lightbox.index}
			origin={lightbox.origin}
			onClose={lightbox.close}
			onEdit={onEditChange
				? (i) => {
						// Straight from previewing it to editing it.
						lightbox.close();
						editingId = sources[i]?.id ?? null;
					}
				: undefined}
			onRemove={onRemove ? (i) => onRemove(sources[i].id) : undefined}
		/>
	{:catch}
		<LoadFailed onclose={lightbox.close} />
	{/await}
{/if}

<style>
	/* Sits between the preview and the timeline so a source can be dragged onto a lane. */
	.rail {
		display: flex;
		align-items: stretch;
		gap: 0.4rem;
		flex-shrink: 0;
		padding: 0 0.4rem;
		border-top: 1px solid var(--line);
	}

	.rail.open {
		padding-bottom: 0.3rem;
	}

	.rail-toggle {
		display: flex;
		align-items: center;
		gap: 0.25rem;
		align-self: center;
		padding: 0.2rem 0.35rem;
		border: none;
		background: none;
		color: var(--text-4);
		font-size: 0.6rem;
		letter-spacing: 0.06em;
		text-transform: uppercase;
		cursor: pointer;
	}

	.rail-toggle:hover {
		color: var(--text-2);
	}

	.rail-count {
		color: var(--text-4);
		font-family: var(--font-mono);
	}

	.rail-items {
		display: flex;
		align-items: center;
		gap: 0.3rem;
		min-width: 0;
		/* A little under the chips, or the strip's clip eats the selected one's bottom edge. */
		padding: 0.3rem 0 2px;
		overflow-x: auto;
	}

	.rail-slot {
		--rail-thumb-h: 34px;
		position: relative;
		flex-shrink: 0;
		line-height: 0;
	}

	.rail-slot.dragging {
		opacity: 0.4;
		cursor: grabbing;
	}

	/* A line in the gap the thumb would land in, not a border on the one under the cursor. */
	.rail-slot.drop-before::before,
	.rail-slot.drop-after::before {
		content: "";
		position: absolute;
		inset-block: 0;
		width: 3px;
		background: var(--mosh);
		border-radius: 1px;
		z-index: 2;
	}

	.rail-slot.drop-before::before {
		left: -0.2rem;
	}

	.rail-slot.drop-after::before {
		right: -0.2rem;
	}

	.rail-item {
		position: relative;
		flex-shrink: 0;
		width: 62px;
		padding: 0;
		border: 1px solid var(--line);
		border-radius: 3px;
		background: #101010;
		/* Clicking is the primary action; grabbing shows only once a drag is under way. */
		cursor: pointer;
		overflow: hidden;
	}

	.rail-item:active {
		cursor: grabbing;
	}

	/* The same accent the clip blocks use for selection. Drawn over the thumb, which
	   would cover an inset shadow on the item itself. */
	.rail-item.playing {
		border-color: var(--mosh);
	}

	.rail-item.playing::after {
		content: "";
		position: absolute;
		inset: 0;
		box-shadow: inset 0 0 0 1px var(--mosh);
		pointer-events: none;
	}

	/* Inside the edge: the strip scrolls, so it clips anything drawn past it. */
	.rail-item:focus-visible {
		outline-offset: -2px;
	}

	/* On the thumb rather than beside it: the rail is a scrolling strip. */
	.rail-edit {
		position: absolute;
		top: 18px;
		right: 2px;
		display: flex;
		padding: 2px;
		border: none;
		border-radius: 2px;
		background: rgba(0, 0, 0, 0.6);
		color: var(--text-3);
		opacity: 0;
		cursor: pointer;
		transition: opacity var(--t-fast);
	}

	.rail-slot:hover .rail-edit,
	.rail-edit:focus-visible {
		opacity: 1;
	}

	/* A keyed source keeps its button lit. */
	.rail-edit.on {
		opacity: 1;
		color: var(--mosh);
	}

	.rail-edit:hover {
		color: var(--text);
	}

	.rail-thumb {
		display: block;
		width: 100%;
		height: var(--rail-thumb-h);
		object-fit: cover;
	}

	.rail-thumb-empty {
		display: flex;
		align-items: center;
		justify-content: center;
		background: #1a1a1a;
		color: var(--text-4);
	}

	.rail-n {
		position: absolute;
		top: 0;
		left: 0;
		padding: 0 3px;
		color: #0b0b0b;
		font-size: 0.55rem;
		font-weight: 700;
		font-family: var(--font-mono);
		line-height: 1.4;
	}

	.rail-kind {
		position: absolute;
		top: 2px;
		right: 2px;
		display: flex;
		align-items: center;
		padding: 0 2px;
		border-radius: 2px;
		background: rgba(0, 0, 0, 0.65);
		color: var(--text-2);
		font-size: 0.5rem;
		font-weight: 700;
	}

	/* Bottom-left of the thumb, anchored by its own bottom. The slot's origin sits
	   on the chip's 1px border. */
	.rail-slot :global(.proxy-badge) {
		position: absolute;
		top: calc(var(--rail-thumb-h) - 1px);
		left: 3px;
		transform: translateY(-100%);
		gap: 2px;
		padding: 0 2px;
		font-size: 0.5rem;
		font-weight: 700;
	}

	.rail-name {
		display: block;
		padding: 1px 2px;
		color: var(--text-4);
		font-size: 0.52rem;
		line-height: 1.3;
		white-space: nowrap;
		overflow: hidden;
		text-overflow: ellipsis;
	}

	.rail-add {
		flex-shrink: 0;
		display: flex;
		align-items: center;
		justify-content: center;
		width: 34px;
		height: 34px;
		border: 1px dashed #2e2e2e;
		border-radius: 3px;
		background: none;
		color: var(--text-4);
		cursor: pointer;
	}

	.rail-add:hover {
		border-color: var(--text-4);
		color: var(--text-2);
	}
</style>
