<script lang="ts">
	import type { Snippet } from "svelte";
	import { Home, Settings } from "lucide-svelte";
	import { openSettings } from "./settings-modal.svelte";
	import GithubLink from "./GithubLink.svelte";
	import YoutubeLink from "./YoutubeLink.svelte";
	import InstagramLink from "./InstagramLink.svelte";
	import FeedbackButton from "./FeedbackButton.svelte";
	import RoundButton from "./RoundButton.svelte";

	/** The strip above the preview: home, the links, then whatever the mode
	 * puts after the separator. */
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
			<RoundButton onclick={onExit} title="Back to upload">
				<Home size={14} />
			</RoundButton>
		{/if}
		<GithubLink />
		<YoutubeLink />
		<InstagramLink />
		<FeedbackButton />
		<RoundButton onclick={openSettings} title="Settings">
			<Settings size={14} />
		</RoundButton>
		<div class="bar-sep"></div>
		{@render status?.()}
		{@render children()}
	</div>
</div>

<style>
	/* A container, so what's inside steps down by the room the bar actually has: the
	   sidebars take a share of the window that a media query can't see. */
	.top-bar {
		container: topbar / inline-size;
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

	/* Below this the bar tightens with the pool actions dropping their labels. */
	@container topbar (max-width: 960px) {
		.toolbar {
			gap: 0.35rem;
		}
	}

	/* The project links are on the upload screen too, so they go first. */
	@container topbar (max-width: 560px) {
		.toolbar :global(.github-link),
		.toolbar :global(.youtube-link) {
			display: none;
		}
	}

	/* Narrower than the controls themselves: a second row rather than a clipped one. */
	@container topbar (max-width: 480px) {
		.toolbar {
			flex-wrap: wrap;
			row-gap: 0.35rem;
		}
	}

	@media (max-width: 800px) {
		.toolbar {
			--round-btn-size: 26px;
		}
	}
</style>
