<script lang="ts">
	import { Disc, Info } from "lucide-svelte";
	import type { Snippet } from "svelte";
	import { getCapabilityReport } from "../../capabilities.svelte";

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

	const exportBlocked = $derived(getCapabilityReport()?.exportBlocked ?? null);

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
		disabled={recording || disabled || !!exportBlocked}
		title={exportBlocked ?? title}
	>
		<Disc size={14} />
		RECORD
	</button>

	{#if showSettings && settingsContent}
		<div class="bar-pop record-settings">
			{@render settingsContent()}
			<p
				class="format-note"
				title="Browsers, Discord and YouTube play WebM. Instagram and the iPhone Photos app don't, so convert it first if it's going there."
			>
				Saves as WebM <Info size={11} />
			</p>
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

	.format-note {
		display: flex;
		align-items: center;
		justify-content: center;
		gap: 0.3rem;
		margin-top: 0.5rem;
		font-family: var(--font-mono);
		font-size: 0.6rem;
		letter-spacing: 0.1em;
		text-transform: uppercase;
		color: var(--text-4);
		cursor: help;
	}
</style>
