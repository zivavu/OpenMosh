<script
	lang="ts"
	generics="C extends TimelineClip, L extends ClipLane<C> & { id: string; name: string }"
>
	import type { ClipLaneController } from "../../timeline/clip-lane-controller.svelte";
	import type { ClipLane, TimelineClip } from "../../timeline/clips";

	/** The draggable joins between clips that share an edge on one lane. */
	interface Props {
		ctrl: ClipLaneController<C, L>;
		lane: L;
	}

	let { ctrl, lane }: Props = $props();
</script>

{#each ctrl.adjacentPairs(lane) as pair (pair.left.id)}
	{const left = ctrl.stack.vp.toPct(pair.at)}
	{#if left >= 0 && left <= 100}
		<div
			class="clip-boundary"
			style="left: {left}%; width: {ctrl.boundaryWidth(
				pair.left,
				pair.right,
			)}px"
			role="presentation"
			title="Drag to trim both clips"
			onpointerdown={(e) =>
				ctrl.onBoundaryPointerDown(e, lane.id, pair.left.id, pair.right.id)}
		></div>
	{/if}
{/each}
