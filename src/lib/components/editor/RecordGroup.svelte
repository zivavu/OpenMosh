<script lang="ts">
	import { Disc } from 'lucide-svelte';
	import type { Snippet } from 'svelte';

	interface Props {
		recording: boolean;
		disabled?: boolean;
		showSettings?: boolean;
		settingsContent?: Snippet;
	}

	let {
		recording,
		disabled = false,
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
		border: 1.5px solid #444;
		border-radius: 999px;
		background: transparent;
		color: #ccc;
		font-size: 0.78rem;
		font-weight: 600;
		letter-spacing: 0.08em;
		font-family: inherit;
		cursor: pointer;
		transition:
			border-color 0.2s,
			color 0.2s,
			background 0.2s;
	}

	.action-btn:hover:not(:disabled) {
		border-color: #888;
		color: #fff;
		background: rgba(255, 255, 255, 0.04);
	}

	.action-btn:disabled {
		opacity: 0.4;
		cursor: default;
	}

	.record-btn:hover:not(:disabled) {
		border-color: #c05050;
		color: #ff8888;
	}

	.record-settings {
		position: absolute;
		bottom: calc(100% + 0.5rem);
		right: 0;
		background: #1a1a1a;
		border: 1px solid #333;
		border-radius: 8px;
		padding: 0.75rem 1rem;
		display: flex;
		flex-direction: column;
		gap: 0.5rem;
		min-width: 230px;
		z-index: 20;
		box-shadow: 0 4px 16px rgba(0, 0, 0, 0.5);
	}

	@media (max-width: 800px) {
		.action-btn {
			padding: 0.6rem 1.2rem;
			font-size: 0.72rem;
		}
	}
</style>
