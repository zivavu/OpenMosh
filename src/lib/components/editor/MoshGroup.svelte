<script lang="ts">
	import { RotateCcw, Settings, X, Zap } from 'lucide-svelte';
	import type { Snippet } from 'svelte';

	interface Props {
		onMosh: () => void;
		onClear: () => void;
		onUndo?: () => void;
		canUndo?: boolean;
		canClear?: boolean;
		showSettings?: boolean;
		settingsContent?: Snippet;
	}

	let {
		onMosh,
		onClear,
		onUndo,
		canUndo = false,
		canClear = false,
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

<div class="mosh-group" bind:this={groupEl}>
	{#if settingsContent}
		<button
			class="settings-btn"
			class:active={showSettings}
			onclick={() => (showSettings = !showSettings)}
			title="Mosh settings"
		>
			<Settings size={14} />
		</button>
	{/if}
	<button class="settings-btn" onclick={onClear} disabled={!canClear} title="Clear all effects" aria-label="Clear all effects">
		<X size={14} />
	</button>
	<button
		class="settings-btn"
		onclick={onUndo}
		disabled={!canUndo}
		title="Undo"
		aria-label="Undo"
	>
		<RotateCcw size={14} />
	</button>
	<button class="action-btn mosh-btn" onclick={onMosh}>
		<Zap size={16} />
		MOSH
	</button>

	{#if showSettings && settingsContent}
		<div class="mosh-settings">
			{@render settingsContent()}
		</div>
	{/if}
</div>

<style>
	.mosh-group {
		position: relative;
		display: flex;
		align-items: center;
		gap: 0.35rem;
	}

	.settings-btn {
		display: flex;
		align-items: center;
		justify-content: center;
		width: 30px;
		height: 30px;
		border-radius: 50%;
		background: none;
		border: 1.5px solid #444;
		color: #888;
		cursor: pointer;
		transition:
			border-color 0.2s,
			color 0.2s;
	}

	.settings-btn:hover,
	.settings-btn.active {
		border-color: #777;
		color: #ccc;
	}

	.settings-btn:disabled {
		opacity: 0.3;
		cursor: default;
		pointer-events: none;
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

	.action-btn:hover {
		border-color: #888;
		color: #fff;
		background: rgba(255, 255, 255, 0.04);
	}

	.mosh-btn:hover {
		border-color: #a89050;
		color: #f0d878;
	}

	.mosh-settings {
		position: absolute;
		bottom: calc(100% + 0.5rem);
		left: 50%;
		transform: translateX(-50%);
		background: #1a1a1a;
		border: 1px solid #333;
		border-radius: 8px;
		padding: 0.75rem 1rem;
		display: flex;
		flex-direction: column;
		gap: 0.5rem;
		min-width: 210px;
		z-index: 20;
		box-shadow: 0 4px 16px rgba(0, 0, 0, 0.5);
	}

	@media (max-width: 800px) {
		.action-btn {
			padding: 0.6rem 1.2rem;
			font-size: 0.72rem;
		}

		.settings-btn {
			width: 26px;
			height: 26px;
		}
	}
</style>
