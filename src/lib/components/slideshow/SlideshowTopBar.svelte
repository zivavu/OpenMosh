<script lang="ts">
	import { Home } from "lucide-svelte";
	import GithubLink from "../ui/GithubLink.svelte";
	import YoutubeLink from "../ui/YoutubeLink.svelte";
	import FeedbackButton from "../ui/FeedbackButton.svelte";
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

<div class="top-bar">
	<div class="toolbar">
		{#if onExit}
			<button class="home-btn" onclick={onExit} title="Back to upload">
				<Home size={14} />
			</button>
		{/if}
		<GithubLink />
		<YoutubeLink />
		<FeedbackButton />
		<div class="bar-sep"></div>
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
	</div>
</div>

<style>
	.top-bar {
		padding: 0.4rem 0.75rem;
		border-bottom: 1px solid var(--line);
		flex-shrink: 0;
	}

	.toolbar {
		display: flex;
		align-items: center;
		gap: 0.5rem;
		min-height: 30px;
	}

	.view-group {
		display: flex;
		align-items: center;
	}

	.home-btn {
		display: flex;
		align-items: center;
		justify-content: center;
		width: 26px;
		height: 26px;
		border-radius: 50%;
		background: var(--glass);
		backdrop-filter: var(--blur);
		-webkit-backdrop-filter: var(--blur);
		border: 1.5px solid var(--line-strong);
		color: var(--text-3);
		cursor: pointer;
		flex-shrink: 0;
		padding: 0;
		box-sizing: border-box;
		transition:
			border-color 0.2s,
			color 0.2s;
	}

	.home-btn:hover {
		border-color: var(--text-3);
		color: var(--text);
	}

</style>
