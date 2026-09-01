	<script lang="ts">
	import { Home } from 'lucide-svelte';
	import GithubLink from '../ui/GithubLink.svelte';
	import FeedbackButton from '../ui/FeedbackButton.svelte';
	import ButtonGroup from '../ui/ButtonGroup.svelte';

	interface Props {
		activeView: 'grid' | 'preview';
		slideCount: number;
		onViewChange: (view: 'grid' | 'preview') => void;
		onExit?: () => void;
	}

	let {
		activeView,
		slideCount,
		onViewChange,
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
		<FeedbackButton />
		<div class="bar-sep"></div>
		<div class="view-group">
			<ButtonGroup
				buttons={[
					{ label: 'Grid', value: 'grid' },
					{ label: 'Preview', value: 'preview' },
				]}
				value={activeView}
				onchange={onViewChange}
			/>
		</div>
		<span class="slide-count readout">{slideCount} images</span>
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

	/* Splits the navigation icons from the view controls: two jobs, one bar. */
	.bar-sep {
		width: 1px;
		height: 18px;
		margin: 0 0.15rem;
		background: var(--line);
		flex-shrink: 0;
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

	.slide-count {
		margin-left: auto;
		font-size: 0.62rem;
		letter-spacing: 0.1em;
		text-transform: uppercase;
		color: var(--text-3);
		white-space: nowrap;
		flex-shrink: 0;
	}
</style>
