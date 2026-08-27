<script lang="ts">
	import { ChevronDown, ChevronUp, Play, Plus, SlidersHorizontal } from 'lucide-svelte';
	import { DEFAULT_SOURCE_EDIT, type SourceEdit } from '../../media';
	import SourceEditor from './SourceEditor.svelte';
	import { readRaw, writeRaw } from '../../storage';
	import {
		SOURCE_DND_TYPE,
		shortSourceName,
		sourceColor,
	} from '../../editor/sequence-source-ui';
	import type { SequenceSource } from '../../editor/sequence-sources.svelte';

	interface Props {
		sources: SequenceSource[];
		/** Segments with no source of their own play this one. */
		primarySourceId?: string | null;
		/** How many segments are selected — a click assigns to all of them. */
		selectedCount?: number;
		/** Marks the thumb the selection currently plays; null when they
		 * disagree. */
		selectedSourceId?: string | null;
		onAssign: (sourceId: string) => void;
		onAdd: () => void;
		/** Per-source edits, keyed by source id. Sparse: only edited media. */
		edits?: Record<string, SourceEdit>;
		onEditChange?: (sourceId: string, edit: SourceEdit) => void;
	}

	let {
		sources,
		primarySourceId = null,
		selectedCount = 0,
		selectedSourceId = null,
		onAssign,
		onAdd,
		edits = {},
		onEditChange,
	}: Props = $props();

	const OPEN_KEY = 'openmosh-seq-rail-open';
	let open = $state(readRaw(OPEN_KEY) !== '0');

	let assignable = $derived(selectedCount > 0);

	/** Source whose editor is open; null when the dialog is closed. */
	let editingId = $state<string | null>(null);
	let editingSource = $derived(sources.find((s) => s.id === editingId) ?? null);

	function isEdited(src: SequenceSource): boolean {
		return !!edits[src.id]?.chromaKey.enabled;
	}

	function toggle() {
		open = !open;
		writeRaw(OPEN_KEY, open ? '1' : '0');
	}

	/** The same payload the grid's cards carry, so the timeline takes a drag
	 * from either place as the same assignment. */
	function onThumbDragStart(e: DragEvent, src: SequenceSource) {
		if (!e.dataTransfer) return;
		e.dataTransfer.effectAllowed = 'copy';
		e.dataTransfer.setData(SOURCE_DND_TYPE, src.id);
		// Some browsers cancel a drag that carries no standard data at all.
		e.dataTransfer.setData('text/plain', src.id);
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
		<div class="rail-items">
			{#each sources as src, i (src.id)}
				<div class="rail-slot">
					<button
						class="rail-item"
						class:playing={src.id === selectedSourceId}
						class:assignable
						draggable="true"
						ondragstart={(e) => onThumbDragStart(e, src)}
						onclick={() => assignable && onAssign(src.id)}
						title={assignable
							? `Play "${src.name}" on the selected segment${selectedCount > 1 ? 's' : ''}, or drag it onto one`
							: `${src.name} — drag onto a segment to play it there`}
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
							<div class="rail-thumb rail-thumb-empty"></div>
						{/if}
						<span class="rail-n" style:background={sourceColor(i + 1)}>{i + 1}</span>
						{#if src.kind === 'video'}
							<span class="rail-kind"><Play size={7} fill="currentColor" /></span>
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
							title="Edit “{src.name}” — remove its background"
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
	<SourceEditor
		source={editingSource}
		edit={edits[editingSource.id] ?? DEFAULT_SOURCE_EDIT}
		onChange={(edit) => onEditChange(editingSource!.id, edit)}
		onClose={() => (editingId = null)}
	/>
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
	}

	.rail-item {
		position: relative;
		flex-shrink: 0;
		width: 62px;
		padding: 0;
		border: 1px solid var(--line);
		border-radius: 3px;
		background: #101010;
		cursor: grab;
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
	   second full-width control per source would halve how many fit. */
	.rail-edit {
		position: absolute;
		top: 2px;
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
		height: 34px;
		object-fit: cover;
	}

	.rail-thumb-empty {
		background: #1a1a1a;
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
		line-height: 1.5;
	}

	/* Both badges can show at once, so the BASE one steps aside. */
	.rail-kind ~ .rail-base {
		right: 16px;
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
