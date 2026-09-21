<script lang="ts">
	import TopBar from "../ui/TopBar.svelte";
	import ButtonGroup from "../ui/ButtonGroup.svelte";
	import MediaPoolActions from "../ui/MediaPoolActions.svelte";

	interface Props {
		activeView: "grid" | "preview";
		slideCount: number;
		onViewChange: (view: "grid" | "preview") => void;
		onShuffle: () => void;
		onAdd: () => void;
		onGenerate: () => void;
		onSnap: () => void;
		onClear: () => void;
		onExit?: () => void;
	}

	let {
		activeView,
		slideCount,
		onViewChange,
		onShuffle,
		onAdd,
		onGenerate,
		onSnap,
		onClear,
		onExit,
	}: Props = $props();
</script>

<TopBar {onExit}>
	<div class="view-group">
		<ButtonGroup
			buttons={[
				{ label: "Preview", value: "preview" },
				{ label: "Grid", value: "grid" },
			]}
			value={activeView}
			onchange={onViewChange}
		/>
	</div>
	<MediaPoolActions
		count={slideCount}
		noun="image"
		recordLabel="Snap"
		shuffleTitle="Shuffle the order"
		recordTitle="Snap webcam stills on the beat"
		{onShuffle}
		{onAdd}
		{onGenerate}
		onRecord={onSnap}
		{onClear}
	/>
</TopBar>

<style>
	.view-group {
		display: flex;
		align-items: center;
	}
</style>
