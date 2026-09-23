<script
	lang="ts"
	generics="C extends TimelineClip, L extends ClipLane<C> & { id: string; name: string }"
>
	import type { ClipLaneController } from "../../timeline/clip-lane-controller.svelte";
	import type { ClipLane, TimelineClip } from "../../timeline/clips";

	/** The draggable joins between clips that share an edge on one lane, the
	 * shift-drag box while one is drawn over it, and where pasted joins would land. */
	interface Props {
		ctrl: ClipLaneController<C, L>;
		lane: L;
	}

	let { ctrl, lane }: Props = $props();

	let editable = $derived(!!ctrl.host.onJoinClick);
	let box = $derived(
		ctrl.marquee?.laneIds.includes(lane.id) ? ctrl.marquee : null,
	);
</script>

{#each ctrl.adjacentPairs(lane) as pair (pair.left.id)}
	{const left = $derived(ctrl.stack.vp.toPct(pair.at))}
	{#if left >= 0 && left <= 100}
		<div
			class="clip-boundary"
			class:editable
			class:selected={ctrl.selectedJoins.includes(pair.right.id)}
			style="left: {left}%; width: {ctrl.boundaryWidth(
				pair.left,
				pair.right,
			)}px"
			role="presentation"
			title={editable
				? "Click to set the transition · drag to trim both clips · shift-click to select"
				: "Drag to trim both clips"}
			onpointerdown={(e) =>
				ctrl.onBoundaryPointerDown(e, lane.id, pair.left.id, pair.right.id)}
		></div>
	{/if}
{/each}

{#each ctrl.pasteGhost(lane.id) as at (at)}
	<div class="join-ghost" style="left: {ctrl.stack.vp.toPct(at)}%"></div>
{/each}

{#if box}
	{const left = $derived(ctrl.stack.vp.toPct(box.from))}
	<div
		class="clip-marquee"
		style="left: {left}%; width: {ctrl.stack.vp.toPct(box.to) - left}%"
	></div>
{/if}
