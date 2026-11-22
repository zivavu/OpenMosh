<script lang="ts">
	import type { Snippet } from "svelte";

	/** The round frosted button of the top bars and the upload screen's corner. With
	 * `href` it's a link (a new tab when it leaves the site); `pill` widens it for text. */
	interface Props {
		title: string;
		/** The accessible name, when it isn't the title. */
		label?: string;
		href?: string;
		onclick?: () => void;
		pill?: boolean;
		class?: string;
		children: Snippet;
	}

	let {
		title,
		label,
		href,
		onclick,
		pill = false,
		class: className = "",
		children,
	}: Props = $props();

	const ariaLabel = $derived(label ?? (pill ? undefined : title));
	const external = $derived(href !== undefined && /^https?:/.test(href));
</script>

{#if href}
	<a
		class="round-btn {className}"
		class:pill
		{href}
		{title}
		aria-label={ariaLabel}
		target={external ? "_blank" : undefined}
		rel={external ? "noopener noreferrer" : undefined}
	>
		{@render children()}
	</a>
{:else}
	<button
		class="round-btn {className}"
		class:pill
		{title}
		aria-label={ariaLabel}
		{onclick}
	>
		{@render children()}
	</button>
{/if}

<style>
	.round-btn {
		display: flex;
		align-items: center;
		justify-content: center;
		gap: 0.4rem;
		width: var(--round-btn-size, 30px);
		height: var(--round-btn-size, 30px);
		padding: 0;
		flex-shrink: 0;
		box-sizing: border-box;
		border: 1.5px solid var(--line-strong);
		border-radius: var(--r-pill);
		background: var(--glass);
		backdrop-filter: var(--blur);
		-webkit-backdrop-filter: var(--blur);
		color: var(--text-2);
		font-family: var(--font-mono);
		font-size: 0.7rem;
		letter-spacing: 0.02em;
		text-decoration: none;
		white-space: nowrap;
		cursor: pointer;
		transition:
			border-color var(--t),
			color var(--t);
	}

	.round-btn:hover {
		border-color: var(--line-hover);
		color: var(--text);
	}

	.pill {
		width: auto;
		padding: 0 0.75rem;
	}
</style>
