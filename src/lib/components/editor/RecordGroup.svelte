<script lang="ts">
	import { Disc } from 'lucide-svelte';
	import type { Snippet } from 'svelte';

	interface Props {
		recording: boolean;
		disabled?: boolean;
		title?: string;
		showSettings?: boolean;
		settingsContent?: Snippet;
	}

	let {
		recording,
		disabled = false,
		title,
		showSettings = $bindable(false),
		settingsContent,
	}: Props = $props();

	let groupEl: HTMLDivElement;

	export function handleClickOutside(e: MouseEvent) {
		if (showSettings && groupEl && !groupEl.contains(e.target as Node)) {
			showSettings = false;
		}
	}
</script>

<div class="record-group" bind:this={groupEl}>
	<button
		class="action-btn record-btn"
		onclick={() => (showSettings = !showSettings)}
		disabled={recording || disabled}
		{title}
	>
		<Disc size={16} />
		RECORD
	</button>

	{#if showSettings && settingsContent}
		<div class="record-settings">
			{@render settingsContent()}
		</div>
	{/if}
</div>

<style>
	.record-group {
		position: relative;
		display: flex;
		align-items: center;
	}

	.action-btn {
		display: inline-flex;
		align-items: center;
		gap: 0.5rem;
		padding: 0.6rem 2rem;
		border: 1.5px solid var(--line-strong);
		border-radius: var(--r-pill);
		background: var(--glass);
		backdrop-filter: var(--blur);
		-webkit-backdrop-filter: var(--blur);
		color: var(--text-2);
		font-family: var(--font-mono);
		font-size: 0.7rem;
		font-weight: 600;
		letter-spacing: 0.14em;
		text-transform: uppercase;
		cursor: pointer;
		transition:
			border-color var(--t),
			color var(--t),
			background var(--t);
	}

	.action-btn:disabled {
		opacity: 0.4;
		cursor: default;
	}

	/* Tally red: the same color the overlay uses while a take is running. */
	.record-btn:hover:not(:disabled) {
		border-color: var(--rec-dim);
		color: var(--rec);
		background: rgba(255, 95, 86, 0.1);
	}

	.record-settings {
		position: absolute;
		bottom: calc(100% + 0.5rem);
		right: 0;
		background: var(--raised);
		border: 1px solid var(--line-strong);
		border-radius: var(--r-3);
		padding: 0.75rem 1rem;
		display: flex;
		flex-direction: column;
		gap: 0.5rem;
		min-width: 230px;
		z-index: 20;
		box-shadow: 0 10px 34px rgba(0, 0, 0, 0.65);
	}

	@media (max-width: 800px) {
		.action-btn {
			padding: 0.6rem 1.2rem;
			font-size: 0.66rem;
		}
	}
</style>
