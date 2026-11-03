<script lang="ts">
	import { Disc, Info } from "lucide-svelte";
	import type { Snippet } from "svelte";
	import { getCapabilityReport } from "../../capabilities.svelte";
	import {
		getExportFormat,
		isMp4Supported,
		probeMp4,
		setExportFormat,
		type VideoContainer,
	} from "../../export-format.svelte";

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

	$effect(() => {
		if (showSettings) void probeMp4();
	});

	const FORMATS: { value: VideoContainer; label: string; hint: string }[] = [
		{
			value: "webm",
			label: "WebM",
			hint: "Browsers, Discord and YouTube play WebM. Instagram and the iPhone Photos app don't.",
		},
		{
			value: "mp4",
			label: "MP4",
			hint: "H.264 MP4 plays almost anywhere, Instagram and the iPhone Photos app included.",
		},
	];
	const MP4_UNSUPPORTED =
		"This browser can't encode H.264, so MP4 is off here. Chrome and Edge can.";

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
			<div class="format-row" role="group" aria-label="Video format">
				{#each FORMATS as f (f.value)}
					{@const off = f.value === "mp4" && isMp4Supported() === false}
					<button
						class="format-btn"
						class:active={getExportFormat() === f.value}
						aria-pressed={getExportFormat() === f.value}
						disabled={off}
						title={off ? MP4_UNSUPPORTED : f.hint}
						onclick={() => setExportFormat(f.value)}
					>
						{f.label}
					</button>
				{/each}
				<span
					class="format-info"
					title={FORMATS.find((f) => f.value === getExportFormat())?.hint}
				>
					<Info size={11} />
				</span>
			</div>
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

	.format-row {
		display: flex;
		align-items: center;
		justify-content: center;
		gap: 0.25rem;
		margin-top: 0.5rem;
	}

	.format-btn {
		padding: 0.2rem 0.6rem;
		border: 1px solid var(--line);
		border-radius: var(--r-2);
		background: none;
		font-family: var(--font-mono);
		font-size: 0.6rem;
		letter-spacing: 0.1em;
		text-transform: uppercase;
		color: var(--text-4);
		cursor: pointer;
	}

	.format-btn.active {
		border-color: var(--rec-dim);
		color: var(--rec);
	}

	.format-btn:disabled {
		opacity: 0.4;
		cursor: not-allowed;
	}

	.format-info {
		display: flex;
		color: var(--text-4);
		cursor: help;
	}
</style>
