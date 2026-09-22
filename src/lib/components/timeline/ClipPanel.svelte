<script lang="ts">
	import type { Snippet } from "svelte";
	import { X } from "lucide-svelte";

	/** The sidebar panel for a selected layer clip: a header naming the lane, then
	 * either the clip's own controls or its effect chain, per the open tab. */
	interface Props {
		/** Null renders the empty prompt instead of the panel. */
		open: boolean;
		emptyText: string;
		section: "clip" | "chain";
		title: string;
		subtitle?: string;
		/** Deselects the clip, which puts the image effects back in the sidebar. */
		onClose?: () => void;
		closeLabel: string;
		controls: Snippet;
		chain: Snippet;
	}

	let {
		open,
		emptyText,
		section,
		title,
		subtitle,
		onClose,
		closeLabel,
		controls,
		chain,
	}: Props = $props();
</script>

{#if !open}
	<p class="empty">{emptyText}</p>
{:else}
	<div class="clip-panel">
		{#if section === "clip"}
			<div class="panel-head">
				<h3 class="panel-title">
					{title}
					{#if subtitle}<span class="panel-sub">{subtitle}</span>{/if}
				</h3>
				{#if onClose}
					<button
						class="close-btn"
						onclick={onClose}
						title="Close (Esc)"
						aria-label={closeLabel}
					>
						<X size={14} />
					</button>
				{/if}
			</div>
			{@render controls()}
		{:else}
			{@render chain()}
		{/if}
	</div>
{/if}

<style>
	.clip-panel {
		display: flex;
		flex-direction: column;
		gap: 0.4rem;
		padding: 0.75rem;
		/* Sits at the top of the sidebar and keeps its natural height: the sidebar
		   is one scroll region, so a scrollbar here would strand the settings below. */
		flex: 0 0 auto;
		border-bottom: 1px solid var(--line);
		/* Matches the effects panel this replaces; without a width the sidebar is
		   sized by this panel's content, and the help text is one unbroken line. */
		width: 100%;
		max-width: var(--sidebar-w);
		box-sizing: border-box;
	}

	@media (max-width: 800px) {
		.clip-panel {
			width: 100%;
			max-width: 100%;
		}
	}

	/* Nothing shrinks: children keep their height and the panel scrolls. */
	.clip-panel > :global(*) {
		flex-shrink: 0;
	}

	/* The nested chain carries the same padding as in the sidebar, so it goes
	   full-bleed here; inside this panel's padding too it read as a sunken box. */
	.clip-panel :global(aside.effects-panel) {
		width: auto;
		max-width: none;
		margin: 0 -0.75rem -0.75rem;
	}

	.empty {
		padding: 0.75rem;
		color: var(--text-3);
		font-size: 0.75rem;
	}

	.panel-head {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: 0.5rem;
	}

	.panel-title {
		margin: 0;
		font-size: 0.7rem;
		font-weight: 600;
		letter-spacing: 0.08em;
		text-transform: uppercase;
		color: var(--text-3);
	}

	.panel-sub {
		margin-left: 0.4rem;
		font-weight: 400;
		letter-spacing: 0;
		text-transform: none;
		color: var(--text-4);
	}

	.close-btn {
		display: flex;
		align-items: center;
		flex-shrink: 0;
		padding: 2px;
		border: none;
		border-radius: 4px;
		background: none;
		color: var(--text-3);
		cursor: pointer;
	}

	.close-btn:hover {
		color: var(--text);
	}

	/* Label, control, read-out. Global so the kinds' own rows and the shared row
	   components all take the one look. */
	.clip-panel :global(.row) {
		display: flex;
		align-items: center;
		gap: 0.5rem;
		font-size: 0.78rem;
	}

	.clip-panel :global(.row label) {
		flex-shrink: 0;
		min-width: 84px;
		color: var(--text-2);
		font-size: 0.75rem;
		/* The row's double-click resets the style; without this it also selects
		   the label text. */
		user-select: none;
	}

	.clip-panel :global(.row select) {
		flex: 1;
		/* Font names are long; without this the select refuses to shrink below
		   its widest option and pushes the row wider than the panel. */
		min-width: 0;
		padding: 0.2rem 0.3rem;
		border: 1px solid var(--line);
		border-radius: 4px;
		background: var(--surface);
		color: var(--text);
		font-size: 0.75rem;
		font-family: inherit;
	}

	.clip-panel :global(.val) {
		min-width: 40px;
		text-align: right;
		color: var(--text-3);
		font-size: 0.75rem;
	}

	.clip-panel :global(.hint),
	.clip-panel :global(.warn) {
		margin: 0;
		font-size: 0.68rem;
		line-height: 1.35;
		color: var(--text-3);
	}

	.clip-panel :global(.warn) {
		color: #d9a441;
	}
</style>
