<script lang="ts">
	import { Disc, Info } from "lucide-svelte";
	import type { Snippet } from "svelte";
	import { getCapabilityReport } from "../../capabilities.svelte";
	import {
		getExportFormat,
		isMp4Supported,
		probeMp4,
		getExportQuality,
		setExportFormat,
		setExportQuality,
		type VideoContainer,
	} from "../../export-format.svelte";
	import type { ExportQuality } from "../../export-quality";

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
	const QUALITIES: { value: ExportQuality; label: string; hint: string }[] = [
		{
			value: "small",
			label: "Small",
			hint: "Smallest file, for chats. Fine detail and heavy glitching come out blocky.",
		},
		{ value: "standard", label: "Standard", hint: "Right for most videos." },
		{
			value: "high",
			label: "High",
			hint: "Up to twice Standard's size, for busy, noisy effects.",
		},
		{
			value: "max",
			label: "Max",
			hint: "Up to four times Standard's size, for YouTube or editing later.",
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

{#snippet choiceRow<T extends string>(
	label: string,
	options: { value: T; label: string; hint: string }[],
	current: T,
	choose: (value: T) => void,
	offReason: (value: T) => string | null = () => null,
)}
	<div class="format-row" role="group" aria-label={label}>
		{#each options as o (o.value)}
			{@const off = offReason(o.value)}
			<button
				class="format-btn"
				class:active={current === o.value}
				aria-pressed={current === o.value}
				disabled={!!off}
				title={off ?? o.hint}
				onclick={() => choose(o.value)}
			>
				{o.label}
			</button>
		{/each}
		<span
			class="format-info"
			title={options.find((o) => o.value === current)?.hint}
		>
			<Info size={11} />
		</span>
	</div>
{/snippet}

<div class="record-group" bind:this={groupEl}>
	<button
		class="bar-key rec"
		class:armed={showSettings}
		onclick={() => (showSettings = !showSettings)}
		disabled={recording || disabled || !!exportBlocked}
		title={exportBlocked ?? title}
	>
		<Disc size={14} />
		<span class="key-label">RECORD</span>
	</button>

	{#if showSettings && settingsContent}
		<div class="bar-pop record-settings">
			{@render settingsContent()}
			{@render choiceRow(
				"Video format",
				FORMATS,
				getExportFormat(),
				setExportFormat,
				(v) =>
					v === "mp4" && isMp4Supported() === false ? MP4_UNSUPPORTED : null,
			)}
			{@render choiceRow(
				"Video quality",
				QUALITIES,
				getExportQuality(),
				setExportQuality,
			)}
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
