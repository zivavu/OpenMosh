<script lang="ts">
	import type { Snippet } from 'svelte';

	interface Props {
		recording: boolean;
		recordProgress: number;
		recordFinalizing: boolean;
		disabled?: boolean;
		onCancelRecording: () => void;
		showSettings?: boolean;
		settingsContent?: Snippet;
	}

	let {
		recording,
		recordProgress,
		recordFinalizing,
		disabled = false,
		onCancelRecording,
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
		<svg
			width="16"
			height="16"
			viewBox="0 0 24 24"
			fill="none"
			stroke="currentColor"
			stroke-width="2"
			stroke-linecap="round"
			stroke-linejoin="round"
		>
			<circle cx="12" cy="12" r="10" />
			<circle cx="12" cy="12" r="4" fill="currentColor" />
		</svg>
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
</style>
