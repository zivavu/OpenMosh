<script lang="ts">
	import type { Snippet } from "svelte";
	import { ChevronDown, Eye, EyeOff, Trash2 } from "lucide-svelte";
	import type { LayerRef } from "../../timeline/layer-order";
	import LaneGrip from "../ui/LaneGrip.svelte";
	import LaneName from "../ui/LaneName.svelte";

	/** The gutter every clip lane wears: grip, fold, eye, name, delete, with
	 * room between the eye and the name for a kind's own switch (solo). */
	interface Props {
		lane: { id: string; name: string; enabled: boolean };
		layerOrder: LayerRef[];
		onLaneDragStart?: (laneId: string, e: PointerEvent) => void;
		folded: boolean;
		onToggleFold?: (laneId: string) => void;
		/** "Hide"/"Show" for a layer, "Mute"/"Unmute" for an fx lane. */
		eyeTitles?: [on: string, off: string];
		onToggleEnabled: () => void;
		nameTitle: string;
		nameActive?: boolean;
		onNameClick: () => void;
		onRename: (name: string) => void;
		onDelete: () => void;
		children?: Snippet;
	}

	let {
		lane,
		layerOrder,
		onLaneDragStart,
		folded,
		onToggleFold,
		eyeTitles = ["Hide this lane", "Show this lane"],
		onToggleEnabled,
		nameTitle,
		nameActive = false,
		onNameClick,
		onRename,
		onDelete,
		children,
	}: Props = $props();
</script>

<div class="tl-gutter">
	<LaneGrip
		{layerOrder}
		laneId={lane.id}
		laneName={lane.name}
		onDragStart={onLaneDragStart}
	/>
	<button
		class="lane-fold"
		class:folded
		title={folded ? "Unfold this lane" : "Fold this lane to a strip"}
		aria-expanded={!folded}
		onclick={() => onToggleFold?.(lane.id)}
	>
		<ChevronDown size={11} />
	</button>
	<button
		class="lane-eye"
		class:off={!lane.enabled}
		title={lane.enabled ? eyeTitles[0] : eyeTitles[1]}
		onclick={onToggleEnabled}
	>
		{#if lane.enabled}<Eye size={12} />{:else}<EyeOff size={12} />{/if}
	</button>
	{@render children?.()}
	<LaneName
		name={lane.name}
		active={nameActive}
		title={nameTitle}
		onclick={onNameClick}
		{onRename}
	/>
	<button class="lane-del" title="Delete this lane" onclick={onDelete}>
		<Trash2 size={12} />
	</button>
</div>

<style>
	.lane-eye,
	.lane-del,
	.lane-fold,
	.tl-gutter :global(.lane-solo),
	.tl-gutter :global(.lane-sound),
	.tl-gutter :global(.lane-drives) {
		display: inline-flex;
		align-items: center;
		padding: 0.15rem;
		border: none;
		background: none;
		color: var(--text-3);
		cursor: pointer;
	}

	.lane-fold {
		transition:
			color var(--t-fast),
			transform var(--t-fast);
	}

	/* Points right when the lane is folded, down when it is open. */
	.lane-fold.folded {
		transform: rotate(-90deg);
	}

	.lane-fold:hover,
	.lane-eye:hover,
	.lane-del:hover {
		color: var(--text);
	}

	.lane-eye.off {
		color: var(--text-4);
	}
</style>
