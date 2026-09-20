<script lang="ts">
	import { HelpCircle, Pause, Play, Settings, Type } from "lucide-svelte";
	import Checkbox from "../ui/Checkbox.svelte";
	import RecordGroup from "../editor/RecordGroup.svelte";
	import ResizeSettings from "../ui/ResizeSettings.svelte";
	import { slideshowShortcutGroups } from "../../editor/shortcut-groups";
	import type { SourceFit } from "../../gl/renderer";
	import { lazy } from "../../lazy";

	// An overlay behind a key; its chunk waits until someone asks for help.
	const loadShortcutsModal = lazy(() => import("../ui/ShortcutsModal.svelte"));

	interface Props {
		previewPlaying: boolean;
		slidesEmpty: boolean;
		trackFile: File | null;
		resizeWidth: number;
		resizeHeight: number;
		naturalWidth: number | undefined;
		naturalHeight: number | undefined;
		recording: boolean;
		recordFps: number;
		recordDuration: number;
		showFps: boolean;
		sourceFit: SourceFit;
		textEnabled?: boolean;
		onToggleText?: () => void;
		onTogglePreview: () => void;
		onStartRecording: () => void;
		onRecordFpsChange: (fps: number) => void;
		onRecordDurationChange: (d: number) => void;
	}

	let {
		previewPlaying,
		slidesEmpty,
		trackFile,
		resizeWidth = $bindable(0),
		resizeHeight = $bindable(0),
		naturalWidth,
		naturalHeight,
		recording,
		recordFps,
		recordDuration,
		showFps = $bindable(false),
		sourceFit = $bindable("contain"),
		textEnabled = false,
		onToggleText,
		onTogglePreview,
		onStartRecording,
		onRecordFpsChange,
		onRecordDurationChange,
	}: Props = $props();

	const isMobile = window.matchMedia("(pointer: coarse)").matches;
	let showOptionsPanel = $state(false);
	let showRecordSettings = $state(false);
	let showShortcuts = $state(false);

	const shortcutGroups = $derived(
		slideshowShortcutGroups({ text: textEnabled }),
	);
	let optionsGroupEl: HTMLDivElement | undefined;
	// svelte-ignore non_reactive_update
	let recordGroupRef: RecordGroup | undefined = undefined;

	$effect(() => {
		function handlePointerDown(e: PointerEvent) {
			recordGroupRef?.handleClickOutside(e as unknown as MouseEvent);
			if (
				showOptionsPanel &&
				optionsGroupEl &&
				!optionsGroupEl.contains(e.target as Node)
			) {
				showOptionsPanel = false;
			}
		}
		window.addEventListener("pointerdown", handlePointerDown);
		return () => window.removeEventListener("pointerdown", handlePointerDown);
	});
</script>

<div class="action-bar">
	<!-- The switches, then the options gear. The sheet hangs off the wrapper,
	     not the cluster, which clips to its corners. -->
	<div class="options-group" bind:this={optionsGroupEl}>
		<div class="bar-cluster">
			{#if !isMobile}
				<button
					class="bar-icon"
					onclick={() => (showShortcuts = true)}
					title="Keyboard shortcuts"
					aria-label="Keyboard shortcuts"
				>
					<HelpCircle size={14} />
				</button>
			{/if}

			{#if onToggleText}
				<button
					class="bar-icon"
					class:on={textEnabled}
					onclick={onToggleText}
					title="Text timeline: timed text layers with their own effects"
					aria-label="Text timeline"
				>
					<Type size={14} />
				</button>
			{/if}

			<button
				class="bar-icon"
				class:open={showOptionsPanel}
				onclick={() => (showOptionsPanel = !showOptionsPanel)}
				title="Options"
				aria-label="Options"
			>
				<Settings size={14} />
			</button>
		</div>
		{#if showOptionsPanel}
			<div class="bar-pop options-panel">
				<div class="setting-row">
					<label for="ss-show-fps">Show FPS</label>
					<Checkbox id="ss-show-fps" bind:checked={showFps} />
				</div>
				<div class="setting-row">
					<label
						for="ss-source-fit"
						title="How to fit slides that don't match the output aspect"
					>
						Fit sources
					</label>
					<select id="ss-source-fit" bind:value={sourceFit}>
						<option value="contain">Contain</option>
						<option value="cover">Cover</option>
						<option value="stretch">Stretch</option>
					</select>
				</div>
				<ResizeSettings
					bind:width={resizeWidth}
					bind:height={resizeHeight}
					{naturalWidth}
					{naturalHeight}
				/>
			</div>
		{/if}
	</div>
	<div class="bar-sep"></div>

	<button class="bar-key live" onclick={onTogglePreview} disabled={slidesEmpty}>
		{#if previewPlaying}
			<Pause size={14} fill="currentColor" stroke="none" />
			STOP
		{:else}
			<Play size={14} fill="currentColor" stroke="none" />
			PLAY
		{/if}
	</button>

	{#if !isMobile}
		<RecordGroup
			bind:this={recordGroupRef}
			{recording}
			disabled={slidesEmpty}
			bind:showSettings={showRecordSettings}
		>
			{#snippet settingsContent()}
				{#if trackFile}
					<div class="setting-row">
						<span class="setting-label">Duration</span>
						<span class="setting-val">{recordDuration.toFixed(1)}s</span>
					</div>
				{:else}
					<div class="setting-row">
						<label for="ss-rec-duration">Duration</label>
						<input
							id="ss-rec-duration"
							type="range"
							min="1"
							max="60"
							step="1"
							value={recordDuration}
							oninput={(e) =>
								onRecordDurationChange(
									+(e.currentTarget as HTMLInputElement).value,
								)}
						/>
						<span class="setting-val">{recordDuration.toFixed(0)}s</span>
					</div>
				{/if}
				<div class="setting-row">
					<label for="ss-rec-fps">FPS</label>
					<select
						id="ss-rec-fps"
						value={recordFps}
						onchange={(e) =>
							onRecordFpsChange(+(e.currentTarget as HTMLSelectElement).value)}
					>
						<option value={15}>15</option>
						<option value={24}>24</option>
						<option value={30}>30</option>
						<option value={60}>60</option>
						<option value={120}>120</option>
					</select>
				</div>
				<button
					class="start-btn"
					onclick={() => {
						showRecordSettings = false;
						onStartRecording();
					}}
				>
					Start Recording{trackFile ? "" : " (silent)"}
				</button>
			{/snippet}
		</RecordGroup>
	{/if}
</div>

{#if showShortcuts}
	{#await loadShortcutsModal() then ShortcutsModal}
		<ShortcutsModal
			groups={shortcutGroups}
			onClose={() => (showShortcuts = false)}
		/>
	{/await}
{/if}

<style>
	.action-bar {
		display: flex;
		align-items: center;
		justify-content: center;
		gap: 0.6rem;
		padding: 0.45rem 0.75rem;
		border-top: 1px solid var(--line);
		flex-shrink: 0;
	}

	.options-group {
		position: relative;
		display: flex;
	}

	.options-panel {
		left: 0;
		min-width: 200px;
	}

	.setting-row {
		display: flex;
		align-items: center;
		gap: 0.5rem;
		font-size: 0.75rem;
	}

	.setting-row label,
	.setting-row .setting-label {
		min-width: 62px;
		font-family: var(--font-mono);
		font-size: 0.62rem;
		font-weight: 500;
		letter-spacing: 0.1em;
		text-transform: uppercase;
		color: var(--text-3);
	}

	.setting-row select {
		flex: 1;
		padding: 0.2rem 0.3rem;
		border: 1px solid var(--line);
		border-radius: var(--r-1);
		background: var(--sunken);
		color: var(--text-2);
		font-family: var(--font-mono);
		font-size: 0.66rem;
	}

	.setting-val {
		color: var(--text-2);
		font-family: var(--font-mono);
		font-size: 0.66rem;
		font-variant-numeric: tabular-nums;
	}

	.setting-row input[type="range"] {
		flex: 1;
		height: 3px;
		appearance: none;
		background: rgba(255, 255, 255, 0.07);
		border-radius: 2px;
		outline: none;
		cursor: pointer;
	}

	.setting-row input[type="range"]::-webkit-slider-thumb {
		appearance: none;
		width: 9px;
		height: 13px;
		border-radius: 1px;
		background: var(--text-2);
		cursor: pointer;
	}

	.setting-row input[type="range"]::-moz-range-thumb {
		width: 9px;
		height: 13px;
		border-radius: 1px;
		background: var(--text-2);
		border: none;
		cursor: pointer;
	}

	.start-btn {
		padding: 0.4rem 0.75rem;
		border: 1.5px solid var(--rec-dim);
		border-radius: var(--r-2);
		background: rgba(255, 95, 86, 0.1);
		color: var(--rec);
		font-family: var(--font-mono);
		font-size: 0.62rem;
		font-weight: 600;
		letter-spacing: 0.1em;
		text-transform: uppercase;
		cursor: pointer;
		transition:
			background var(--t-fast),
			color var(--t-fast);
	}

	.start-btn:hover:not(:disabled) {
		background: rgba(255, 95, 86, 0.2);
		color: #ffa8a2;
	}

	.start-btn:disabled {
		opacity: 0.4;
		cursor: default;
	}
</style>
