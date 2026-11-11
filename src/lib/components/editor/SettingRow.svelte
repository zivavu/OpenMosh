<script lang="ts">
	import type { Snippet } from "svelte";

	interface Props {
		label: string;
		/** The control's id; without one the label is plain text. */
		for?: string;
		title?: string;
		children: Snippet;
	}

	let { label, for: forId, title, children }: Props = $props();
</script>

<!-- A label and its control in a settings popover. -->
<div class="row">
	{#if forId}
		<label for={forId} {title}>{label}</label>
	{:else}
		<span class="label" {title}>{label}</span>
	{/if}
	{@render children()}
</div>

<style>
	.row {
		display: flex;
		align-items: center;
		gap: 0.5rem;
	}

	label,
	.label {
		font-family: var(--font-mono);
		font-size: 0.62rem;
		font-weight: 500;
		letter-spacing: 0.1em;
		text-transform: uppercase;
		color: var(--text-3);
		min-width: 72px;
		flex-shrink: 0;
	}

	.row :global(select) {
		flex: 1;
		background-color: var(--sunken);
		color: var(--text-2);
		border-radius: var(--r-1);
		padding-block: 0.2rem;
		padding-left: 0.4rem;
		font-family: var(--font-mono);
		font-size: 0.66rem;
	}
</style>
