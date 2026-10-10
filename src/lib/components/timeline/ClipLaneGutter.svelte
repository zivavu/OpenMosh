<script lang="ts">
	import type { Snippet } from "svelte";
	import {
		ChevronDown,
		Eye,
		EyeOff,
		Trash2,
		Volume2,
		VolumeX,
	} from "lucide-svelte";
	import type { LayerRef } from "../../timeline/layer-order";
	import LaneGrip from "../ui/LaneGrip.svelte";
	import LaneName from "../ui/LaneName.svelte";
	import { tryGetTimelineStack } from "../../editor/timeline-stack.svelte";

	/** The gutter every clip lane wears: grip, name, then eye, a kind's own
	 * switches (solo first), fold, delete and `trailing` last (a speaker eye after it). Where there's a mouse
	 * the controls wait for a hover, apart from the ones holding a non-default state:
	 * those belong in `trailing`, so the hover doesn't move them. */
	interface Props {
		lane: { id: string; name: string; enabled: boolean };
		layerOrder: LayerRef[];
		onLaneDragStart?: (laneId: string, e: PointerEvent) => void;
		folded: boolean;
		onToggleFold?: (laneId: string) => void;
		/** "Hide"/"Show" for a layer, "Mute"/"Unmute" for an fx lane. */
		eyeTitles?: [on: string, off: string];
		/** A sound-only lane mutes rather than hides, so it shows a speaker. */
		eyeIcon?: "eye" | "sound";
		onToggleEnabled: () => void;
		nameTitle: string;
		nameActive?: boolean;
		onNameClick: () => void;
		onRename: (name: string) => void;
		onDelete: () => void;
		children?: Snippet;
		trailing?: Snippet;
	}

	let {
		lane,
		layerOrder,
		onLaneDragStart,
		folded,
		onToggleFold,
		eyeTitles = ["Hide this lane", "Show this lane"],
		eyeIcon = "eye",
		onToggleEnabled,
		nameTitle,
		nameActive = false,
		onNameClick,
		onRename,
		onDelete,
		children,
		trailing,
	}: Props = $props();

	const stack = tryGetTimelineStack();
</script>

<!-- svelte-ignore a11y_no_static_element_interactions -->
<div
	class="tl-gutter"
	onpointerdowncapture={() => stack?.markLaneUsed(lane.id)}
>
	<LaneGrip
		{layerOrder}
		laneId={lane.id}
		laneName={lane.name}
		onDragStart={onLaneDragStart}
	/>
	<LaneName
		name={lane.name}
		active={nameActive}
		title={nameTitle}
		onclick={onNameClick}
		{onRename}
	/>
	{#if eyeIcon === "eye"}{@render eye()}{/if}
	{@render children?.()}
	<button
		class="lane-fold"
		class:folded
		title={folded ? "Unfold this lane" : "Fold this lane to a strip"}
		aria-expanded={!folded}
		onclick={() => onToggleFold?.(lane.id)}
	>
		<ChevronDown size={11} />
	</button>
	<button class="lane-del" title="Delete this lane" onclick={onDelete}>
		<Trash2 size={12} />
	</button>
	{@render trailing?.()}
	<!-- A speaker sits last, where the media lanes keep their mute. -->
	{#if eyeIcon === "sound"}{@render eye()}{/if}
</div>

{#snippet eye()}
	<button
		class="lane-eye"
		class:off={!lane.enabled}
		title={lane.enabled ? eyeTitles[0] : eyeTitles[1]}
		onclick={onToggleEnabled}
	>
		{#if eyeIcon === "sound"}
			{#if lane.enabled}<Volume2 size={12} />{:else}<VolumeX size={12} />{/if}
		{:else if lane.enabled}<Eye size={12} />{:else}<EyeOff size={12} />{/if}
	</button>
{/snippet}

<style>
	.lane-eye,
	.lane-del,
	.lane-fold,
	.tl-gutter :global(.lane-solo),
	.tl-gutter :global(.lane-sound),
	.tl-gutter :global(.lane-copy),
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

	/* At rest a row shows its title, plus any switch that is off or on. */
	@media (hover: hover) {
		.tl-gutter > :global(button:not(.lane-name, .lane-grip, .off, .on)) {
			display: none;
		}

		.tl-gutter > :global(.lane-grip) {
			visibility: hidden;
		}

		.tl-gutter:hover > :global(button:not(.lane-name)),
		.tl-gutter:focus-within > :global(button:not(.lane-name)) {
			display: inline-flex;
			visibility: visible;
		}

		:global(.tl-row.lifted) > .tl-gutter > :global(.lane-grip) {
			visibility: visible;
		}
	}
</style>
