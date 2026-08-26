<script lang="ts">
	import { GripVertical } from 'lucide-svelte';
	import { stackTitle, type LayerRef } from '../../timeline/layer-order';

	interface Props {
		/** Every row of the stack, front first — for naming this one's neighbours. */
		layerOrder: LayerRef[];
		laneId: string;
		/** For the accessible name, and for the tooltip's "drag to restack". */
		laneName: string;
		/** Absent on a lane whose stack cannot be reordered: the handle then
		 * still says where the row sits, but does not offer to move it. */
		onDragStart?: (laneId: string, e: PointerEvent) => void;
	}

	let { layerOrder, laneId, laneName, onDragStart }: Props = $props();

	let title = $derived(
		`${stackTitle(layerOrder, laneId)}${onDragStart ? ' — drag to restack' : ''}`,
	);
</script>

<!--
	The reorder handle every stacking lane carries — media, text and fx rows all
	wear this one, at the head of the gutter, so "grab here to restack" is
	learned once. Where a row sits in the stack is already told by where it sits
	in the column, so the handle only has to say "drag me": the neighbours it
	would land between are in its tooltip.
-->
<button
	class="lane-grip"
	class:draggable={!!onDragStart}
	{title}
	aria-label="Reorder {laneName}"
	onpointerdown={(e) => onDragStart?.(laneId, e)}
>
	<GripVertical size={12} />
</button>

<style>
	.lane-grip {
		display: inline-flex;
		align-items: center;
		justify-content: center;
		flex-shrink: 0;
		width: 14px;
		/* Full row height: a 12px icon is a small thing to catch, and the gutter
		   has no other use for the column it sits in. */
		align-self: stretch;
		padding: 0;
		border: none;
		background: none;
		color: var(--text-4);
		transition: color var(--t-fast);
	}

	.lane-grip.draggable {
		cursor: grab;
		touch-action: none;
	}

	.lane-grip.draggable:hover {
		color: var(--live);
	}

	/* The lifted look is the row's to declare — it owns the drag state — so the
	   ancestor half of this selector is the parent's, not ours. */
	:global(.lifted) .lane-grip {
		cursor: grabbing;
		color: var(--live);
	}
</style>
