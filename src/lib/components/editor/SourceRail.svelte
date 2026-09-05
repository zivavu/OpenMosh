<script lang="ts">
	import {
		ChevronDown,
		ChevronUp,
		ImageOff,
		Play,
		Plus,
		SlidersHorizontal,
		TriangleAlert,
		Zap,
	} from 'lucide-svelte';
	import {
		DEFAULT_SOURCE_EDIT,
		hasAnimation,
		isFullCrop,
		type SourceEdit,
	} from '../../media';
	import { lazy } from '../../lazy';
	import { readRaw, writeRaw } from '../../storage';
	import {
		SOURCE_DND_TYPE,
		shortSourceName,
		sourceColor,
	} from '../../editor/sequence-source-ui';
	import type { SequenceSource } from '../../editor/sequence-sources.svelte';
	import { proxyStatus } from '../../video/proxy-status';

	// Both are overlays: neither chunk is needed until one is actually opened.
	const loadSourceEditor = lazy(() => import('./SourceEditor.svelte'));
	const loadMediaLightbox = lazy(() => import('../ui/MediaLightbox.svelte'));

	interface Props {
		sources: SequenceSource[];
		/** Segments with no source of their own play this one. */
		primarySourceId?: string | null;
		/** How many things are selected — a click assigns to all of them. */
		selectedCount?: number;
		/** What those things are, for the tooltip: segments, or layer clips. */
		selectedLabel?: string;
		/** Marks the thumb the selection currently plays; null when they
		 * disagree. */
		selectedSourceId?: string | null;
		onAssign: (sourceId: string) => void;
		onAdd: () => void;
		/** Drag one thumb onto another to move it there. */
		onReorder?: (from: number, to: number) => void;
		/** Per-source edits, keyed by source id. Sparse: only edited media. */
		edits?: Record<string, SourceEdit>;
		onEditChange?: (sourceId: string, edit: SourceEdit) => void;
		/** Fired as the media edit modal opens and closes. The editor stops
		 * playback while it is up: the modal has its own transport, and a clip
		 * running behind it fights the one being scrubbed inside. */
		onEditingChange?: (open: boolean) => void;
	}

	let {
		sources,
		primarySourceId = null,
		selectedCount = 0,
		selectedLabel = 'segment',
		selectedSourceId = null,
		onAssign,
		onAdd,
		onReorder,
		edits = {},
		onEditChange,
		onEditingChange,
	}: Props = $props();

	const OPEN_KEY = 'openmosh-seq-rail-open';
	let open = $state(readRaw(OPEN_KEY) !== '0');

	let assignable = $derived(selectedCount > 0);

	/** Open thumb's index; null when the preview is closed. Same component and
	 * same click rule the grid's cards use: a click previews, unless a segment is
	 * selected and the click means "play this there". */
	let lightboxIndex = $state<number | null>(null);
	let lightboxOrigin = $state({ x: 0, y: 0 });

	let lightboxItems = $derived(
		sources.map((s) => ({ name: s.name, kind: s.kind, objectUrl: s.objectUrl })),
	);

	function openLightbox(e: MouseEvent, index: number) {
		const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
		lightboxOrigin = {
			x: rect.left + rect.width / 2 - window.innerWidth / 2,
			y: rect.top + rect.height / 2 - window.innerHeight / 2,
		};
		lightboxIndex = index;
	}

	/** Source whose editor is open; null when the dialog is closed. */
	let editingId = $state<string | null>(null);
	let editingSource = $derived(sources.find((s) => s.id === editingId) ?? null);

	// Report the modal's state up, so the editor can stop the preview behind it.
	$effect(() => onEditingChange?.(!!editingSource));

	/** Any of the three tools having been used, not just the key: the lit button
	 * is how the rail says this media is not what the file holds. */
	function isEdited(src: SequenceSource): boolean {
		const e = edits[src.id];
		return (
			!!e &&
			(e.chromaKey.enabled || !isFullCrop(e.crop) || !!e.mask || hasAnimation(e))
		);
	}

	function toggle() {
		open = !open;
		writeRaw(OPEN_KEY, open ? '1' : '0');
	}

	/** The scrolling strip, for centring the highlighted thumb. */
	let itemsEl = $state<HTMLDivElement | undefined>(undefined);

	/** Follow the highlight: the rail holds more thumbs than fit, and the source
	 * behind a newly selected clip or segment is often scrolled off it. Measured
	 * against the strip rather than scrollIntoView, which would scroll the
	 * editor's ancestors as well as this one. */
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
		strip.scrollBy({ left: delta, behavior: 'smooth' });
	});

	// Reorder, the same gesture the grid's cards use: a thumb carries its index
	// for a drop in here, and its id under our own type so a drop on a lane or a
	// segment is still read as an assignment.
	let dragFromIndex = $state<number | null>(null);
	let dragOverIndex = $state<number | null>(null);

	function onThumbDragStart(e: DragEvent, src: SequenceSource, index: number) {
		dragFromIndex = index;
		if (!e.dataTransfer) return;
		e.dataTransfer.effectAllowed = 'copyMove';
		e.dataTransfer.setData(SOURCE_DND_TYPE, src.id);
		// Some browsers cancel a drag that carries no standard data at all.
		e.dataTransfer.setData('text/plain', src.id);
	}

	/** Which edge of slot `i` the insertion line belongs on — see the grid's
	 * copy: a thumb moved rightwards lands after the one it was dropped on. */
	function dropEdge(i: number): 'before' | 'after' | null {
		if (dragFromIndex === null || dragOverIndex !== i || dragFromIndex === i) {
			return null;
		}
		return dragFromIndex < i ? 'after' : 'before';
	}

	function endThumbDrag() {
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
		title={open ? 'Hide the media rail' : 'Show the media rail'}
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
				{@const edge = dropEdge(i)}
				<div
					class="rail-slot"
					class:dragging={dragFromIndex === i}
					class:drop-before={edge === 'before'}
					class:drop-after={edge === 'after'}
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
						class:assignable
						draggable="true"
						ondragstart={(e) => onThumbDragStart(e, src, i)}
						onclick={(e) => {
							if (assignable) onAssign(src.id);
							else openLightbox(e, i);
						}}
						ondblclick={(e) => openLightbox(e, i)}
						title={assignable
							? `Play "${src.name}" on the selected ${selectedLabel}${selectedCount > 1 ? 's' : ''}, or drag it onto one. Double-click to preview.`
							: `${src.name} — click to preview, or drag it onto a segment or layer clip`}
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
						<span class="rail-n" style:background={sourceColor(i + 1)}>{i + 1}</span>
						{#if src.kind === 'video'}
							<span class="rail-kind"><Play size={7} fill="currentColor" /></span>
							{@const proxy = proxyStatus(src)}
							{#if proxy.kind === 'pending'}
								<span class="rail-proxy" title={proxy.title}>{proxy.badge}</span>
							{:else if proxy.kind === 'failed'}
								<span class="rail-proxy warn" title={proxy.title}>
									<TriangleAlert size={7} />
								</span>
							{:else if proxy.kind === 'ready'}
								<span class="rail-proxy ok" title={proxy.title}>
									<Zap size={7} fill="currentColor" />
									{proxy.badge}
								</span>
							{/if}
						{/if}
						{#if src.id === primarySourceId}
							<span class="rail-base">B</span>
						{/if}
						<span class="rail-name">{shortSourceName(src.name, 10)}</span>
					</button>
					{#if onEditChange}
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
			<button class="rail-add" onclick={onAdd} title="Add images or videos">
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
	{/await}
{/if}

{#if lightboxIndex !== null}
	{#await loadMediaLightbox() then MediaLightbox}
		<MediaLightbox
			items={lightboxItems}
			bind:index={lightboxIndex}
			origin={lightboxOrigin}
			onClose={() => (lightboxIndex = null)}
			onEdit={onEditChange
				? (i) => {
						// Straight from previewing it to editing it: seeing the media at
						// size is when it becomes obvious something has to come out of it.
						lightboxIndex = null;
						editingId = sources[i]?.id ?? null;
					}
				: undefined}
		/>
	{/await}
{/if}

<style>
	/* Sits between the preview and the timeline so a source can be dragged onto
	   a segment without swapping the preview out for the grid. */
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
		padding: 0.3rem 0 0;
		overflow-x: auto;
		scrollbar-width: thin;
	}

	.rail-slot {
		position: relative;
		flex-shrink: 0;
		line-height: 0;
	}

	.rail-slot.dragging {
		opacity: 0.4;
		cursor: grabbing;
	}

	/* A line in the gap the thumb would land in, rather than a border on the one
	   under the cursor — that reads as "this is selected" instead of "it goes
	   here". Same indicator the grid uses. */
	.rail-slot.drop-before::before,
	.rail-slot.drop-after::before {
		content: '';
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
		--rail-thumb-h: 34px;
		position: relative;
		flex-shrink: 0;
		width: 62px;
		padding: 0;
		border: 1px solid var(--line);
		border-radius: 3px;
		background: #101010;
		/* Clicking is the primary action (assign, or preview); the drag is the
		   secondary one, so grabbing shows only once one is under way. */
		cursor: pointer;
		overflow: hidden;
	}

	.rail-item:active {
		cursor: grabbing;
	}

	.rail-item.assignable:hover {
		border-color: var(--mosh);
	}

	/* What the selected segments already play — the same accent the segment
	   blocks use for selection. */
	.rail-item.playing {
		border-color: var(--mosh);
		box-shadow: inset 0 0 0 1px var(--mosh);
	}

	/* On the thumb rather than beside it: the rail is a scrolling strip, and a
	   second full-width control per source would halve how many fit. Bottom
	   corner, because the top-right one belongs to the kind and base badges. */
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

	/* A keyed source keeps its button lit, so the rail says which media has
	   been edited without hovering every thumb. */
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

	.rail-kind,
	.rail-base {
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

	/* Both badges can show at once, so the BASE one steps aside. */
	.rail-kind ~ .rail-base {
		right: 16px;
	}

	/* Bottom-left of the thumb. The top edge already carries the index, the
	   kind and base badges and the edit button, and this one is the widest of
	   them. Anchored by its own bottom rather than by a top offset, so the text
	   inside it can't push it past the thumb and onto the name. */
	.rail-proxy {
		position: absolute;
		top: calc(var(--rail-thumb-h) - 2px);
		left: 2px;
		transform: translateY(-100%);
		display: inline-flex;
		align-items: center;
		gap: 2px;
		padding: 0 2px;
		border-radius: 2px;
		background: rgba(0, 0, 0, 0.65);
		color: var(--text-3);
		font-size: 0.5rem;
		font-weight: 700;
	}

	.rail-proxy.ok {
		color: var(--live);
	}

	.rail-proxy.warn {
		color: var(--start);
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
		width: 26px;
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
