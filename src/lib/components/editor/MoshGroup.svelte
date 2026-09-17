<script lang="ts">
	import { RotateCcw, Settings, X, Zap } from "lucide-svelte";
	import type { Snippet } from "svelte";

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
	<!-- The session switches: settings, then the two that undo what MOSH did. -->
	{#if settingsContent || !hideActions}
		<div class="bar-cluster">
			{#if settingsContent}
				<button
					class="bar-icon"
					class:open={showSettings}
					onclick={() => (showSettings = !showSettings)}
					title="Mosh settings"
					aria-label="Mosh settings"
				>
					<Settings size={14} />
				</button>
			{/if}
			{#if !hideActions}
				<button
					class="bar-icon"
					onclick={onClear}
					disabled={!canClear}
					title="Clear all effects"
					aria-label="Clear all effects"
				>
					<X size={14} />
				</button>
				<button
					class="bar-icon"
					onclick={onUndo}
					disabled={!canUndo}
					title="Undo"
					aria-label="Undo"
				>
					<RotateCcw size={14} />
				</button>
			{/if}
		</div>
	{/if}
	{#if !hideActions}
		<button class="bar-key mosh" onclick={onMosh}>
			<Zap size={14} />
			MOSH
		</button>
	{/if}

	{#if showSettings && settingsContent}
		<div class="bar-pop mosh-settings">
			{@render settingsContent()}
		</div>
	{/if}
</div>

<style>
	.mosh-group {
		position: relative;
		display: flex;
		align-items: center;
		gap: 0.4rem;
	}

	.mosh-settings {
		left: 50%;
		transform: translateX(-50%);
		min-width: 210px;
	}

	@media (max-width: 450px) {
		.mosh-group {
			gap: 0.25rem;
		}
	}
</style>
