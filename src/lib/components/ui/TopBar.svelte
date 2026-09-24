<script lang="ts">
	import type { Snippet } from "svelte";
	import { Home } from "lucide-svelte";
	import GithubLink from "./GithubLink.svelte";
	import YoutubeLink from "./YoutubeLink.svelte";
	import FeedbackButton from "./FeedbackButton.svelte";

	/** The strip above the preview: home, the links, then whatever the mode
	 * puts after the separator. A `.help-btn` in there gets the home button's round look. */
	interface Props {
		onExit?: () => void;
		/** Whether the edit is saved, right after the links. */
		status?: Snippet;
		children: Snippet;
	}

	let { onExit, status, children }: Props = $props();
</script>

<div class="top-bar">
	<div class="toolbar">
		{#if onExit}
			<button class="help-btn" onclick={onExit} title="Back to upload">
				<Home size={14} />
			</button>
		{/if}
		<GithubLink />
		<YoutubeLink />
		<FeedbackButton />
		<div class="bar-sep"></div>
		{@render status?.()}
		{@render children()}
	</div>
</div>

<style>
	.top-bar {
		display: flex;
		align-items: center;
		padding: 4px 12px;
		border-bottom: 1px solid var(--line);
		flex-shrink: 0;
	}

	.toolbar {
		flex: 1;
		min-width: 0;
		display: flex;
		align-items: center;
		gap: 0.5rem;
	}

	.toolbar :global(.help-btn) {
		display: flex;
		align-items: center;
		justify-content: center;
		width: 30px;
		height: 30px;
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
			border-color var(--t),
			color var(--t);
	}

	.toolbar :global(.help-btn:hover) {
		border-color: var(--text-3);
		color: var(--text);
	}

	/* Below this the bar tightens with the pool actions dropping their labels. */
	@media (max-width: 1200px) {
		.top-bar {
			padding: 7px 8px 6px;
		}

		.toolbar {
			gap: 0.35rem;
		}
	}

	@media (max-width: 800px) {
		.toolbar :global(.help-btn) {
			width: 26px;
			height: 26px;
		}
	}
</style>
