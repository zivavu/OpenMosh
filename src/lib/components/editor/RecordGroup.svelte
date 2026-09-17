<script lang="ts">
	import { Disc } from "lucide-svelte";
	import type { Snippet } from "svelte";

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
		class="bar-key rec"
		class:armed={showSettings}
		onclick={() => (showSettings = !showSettings)}
		disabled={recording || disabled}
		{title}
	>
		<Disc size={14} />
		RECORD
	</button>

	{#if showSettings && settingsContent}
		<div class="bar-pop record-settings">
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

	/* Stays lit while its sheet is open, so the pair reads as one control. */
	.armed {
		border-color: var(--rec-dim);
		color: var(--rec);
	}

	.record-settings {
		right: 0;
		min-width: 230px;
	}
</style>
