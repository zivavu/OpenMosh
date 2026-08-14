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
		/** Hide the mosh/clear/undo buttons but keep the settings gear (sequence
		 * mode). Gate this on the sequence timeline actually being rendered —
		 * otherwise these actions vanish with nothing replacing them. */
		hideActions?: boolean;
	}

	let {
		onMosh,
		onClear,
		onUndo,
		canUndo = false,
		canClear = false,
		showSettings = $bindable(false),
		settingsContent,
		hideActions = false,
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
	{#if !hideActions}
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
	{/if}

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
		background: var(--glass);
		backdrop-filter: var(--blur);
		-webkit-backdrop-filter: var(--blur);
		border: 1.5px solid var(--line-strong);
		color: var(--text-3);
		cursor: pointer;
		transition:
			border-color var(--t),
			color var(--t);
	}

	.settings-btn:hover,
	.settings-btn.active {
		border-color: var(--text-3);
		color: var(--text);
	}

	.settings-btn:disabled {
		opacity: 0.3;
		cursor: default;
		pointer-events: none;
	}

	/* The primary action in the app: the only control that gets a filled look. */
	.action-btn {
		display: inline-flex;
		align-items: center;
		gap: 0.5rem;
		padding: 0.6rem 2rem;
		border: 1.5px solid var(--mosh-dim);
		border-radius: var(--r-pill);
		background: rgba(198, 162, 234, 0.1);
		backdrop-filter: var(--blur);
		-webkit-backdrop-filter: var(--blur);
		color: var(--mosh);
		font-family: var(--font-mono);
		font-size: 0.72rem;
		font-weight: 700;
		letter-spacing: 0.16em;
		text-transform: uppercase;
		cursor: pointer;
		transition:
			border-color var(--t),
			color var(--t),
			background var(--t),
			box-shadow var(--t);
	}

	.mosh-btn:hover {
		border-color: var(--mosh);
		background: rgba(198, 162, 234, 0.2);
		color: #f0e2ff;
		box-shadow: 0 0 18px rgba(198, 162, 234, 0.25);
	}

	.mosh-settings {
		position: absolute;
		bottom: calc(100% + 0.5rem);
		left: 50%;
		transform: translateX(-50%);
		background: var(--raised);
		border: 1px solid var(--line-strong);
		border-radius: var(--r-3);
		padding: 0.75rem 1rem;
		display: flex;
		flex-direction: column;
		gap: 0.5rem;
		min-width: 210px;
		z-index: 20;
		box-shadow: 0 10px 34px rgba(0, 0, 0, 0.65);
	}

	@media (max-width: 800px) {
		.action-btn {
			padding: 0.6rem 1.2rem;
			font-size: 0.66rem;
		}

		.settings-btn {
			width: 26px;
			height: 26px;
		}
	}
</style>
