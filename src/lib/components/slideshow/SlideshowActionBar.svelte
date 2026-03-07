<script lang="ts">
	import type { RecordFormat } from '../../recorder';
	import RecordGroup from '../editor/RecordGroup.svelte';
	import ResizeSettings from '../ui/ResizeSettings.svelte';

	interface Props {
		previewPlaying: boolean;
		slidesEmpty: boolean;
		trackFile: File | null;
		resizeWidth: number;
		resizeHeight: number;
		naturalWidth: number | undefined;
		naturalHeight: number | undefined;
		recording: boolean;
		recordProgress: number;
		recordFinalizing: boolean;
		recordFormat: RecordFormat;
		recordFps: number;
		recordDuration: number;
		onTogglePreview: () => void;
		onStartRecording: () => void;
		onCancelRecording: () => void;
		onRecordFormatChange: (f: RecordFormat) => void;
		onRecordFpsChange: (fps: number) => void;
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
		recordProgress,
		recordFinalizing,
		recordFormat,
		recordFps,
		recordDuration,
		onTogglePreview,
		onStartRecording,
		onCancelRecording,
		onRecordFormatChange,
		onRecordFpsChange,
	}: Props = $props();

	let showOptionsPanel = $state(false);
	let showRecordSettings = $state(false);
	let optionsGroupEl: HTMLDivElement | undefined;
	let recordGroupRef = $state<RecordGroup>();

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
		window.addEventListener('pointerdown', handlePointerDown);
		return () => window.removeEventListener('pointerdown', handlePointerDown);
	});
</script>

<div class="action-bar">
	<div class="options-group" bind:this={optionsGroupEl}>
		<button
			class="action-btn options-btn"
			onclick={() => (showOptionsPanel = !showOptionsPanel)}
			title="Preview size options"
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
				<circle cx="12" cy="12" r="3" />
				<path
					d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z"
				/>
			</svg>
			OPTIONS
		</button>
		{#if showOptionsPanel}
			<div class="options-panel">
				<ResizeSettings
					bind:width={resizeWidth}
					bind:height={resizeHeight}
					{naturalWidth}
					{naturalHeight}
				/>
			</div>
		{/if}
	</div>

	<button
		class="action-btn play-btn"
		onclick={onTogglePreview}
		disabled={slidesEmpty}
	>
		{#if previewPlaying}
			<svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor">
				<rect x="6" y="4" width="4" height="16" />
				<rect x="14" y="4" width="4" height="16" />
			</svg>
			STOP
		{:else}
			<svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor">
				<polygon points="5 3 19 12 5 21 5 3" />
			</svg>
			PLAY
		{/if}
	</button>

	<RecordGroup
		bind:this={recordGroupRef}
		{recording}
		{recordProgress}
		{recordFinalizing}
		disabled={slidesEmpty}
		bind:showSettings={showRecordSettings}
		onCancelRecording={onCancelRecording}
	>
		{#snippet settingsContent()}
			<div class="setting-row">
				<label for="ss-rec-format">Format</label>
				<select
					id="ss-rec-format"
					value={recordFormat}
					onchange={(e) =>
						onRecordFormatChange(
							(e.currentTarget as HTMLSelectElement).value as RecordFormat,
						)}
				>
					<option value="webm">WebM</option>
					<option value="gif">GIF</option>
				</select>
			</div>
			<div class="setting-row">
				<span class="setting-label">Duration</span>
				<span class="setting-val">{recordDuration.toFixed(1)}s</span>
			</div>
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
				</select>
				{#if recordFormat === 'gif' && recordFps > 15}
					<span class="hint">capped to 15</span>
				{/if}
			</div>
			<button
				class="start-btn"
				onclick={() => {
					showRecordSettings = false;
					onStartRecording();
				}}
				disabled={!trackFile}
			>
				{trackFile ? 'Start Recording' : 'Add audio first'}
			</button>
		{/snippet}
	</RecordGroup>
</div>

<style>
	.action-bar {
		display: flex;
		align-items: center;
		justify-content: center;
		gap: 0.5rem;
		padding: 0.5rem 0.75rem;
		border-top: 1px solid #2a2a2a;
		flex-shrink: 0;
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
		font-size: 0.75rem;
		font-weight: 700;
		letter-spacing: 0.06em;
		cursor: pointer;
		font-family: inherit;
	}

	.action-btn:hover:not(:disabled) {
		border-color: #888;
		color: #fff;
	}

	.action-btn:disabled {
		opacity: 0.4;
		cursor: default;
	}

	.play-btn:hover:not(:disabled) {
		border-color: #4a7;
		color: #8fc;
	}

	.options-group {
		position: relative;
		display: flex;
		align-items: center;
	}

	.options-btn:hover:not(:disabled) {
		border-color: #888;
		color: #fff;
	}

	.options-panel {
		position: absolute;
		bottom: calc(100% + 0.5rem);
		left: 0;
		background: #1a1a1a;
		border: 1px solid #333;
		border-radius: 8px;
		padding: 0.75rem 1rem;
		display: flex;
		flex-direction: column;
		gap: 0.5rem;
		min-width: 200px;
		z-index: 20;
		box-shadow: 0 4px 16px rgba(0, 0, 0, 0.5);
	}

	.setting-row {
		display: flex;
		align-items: center;
		gap: 0.5rem;
		font-size: 0.75rem;
	}

	.setting-row label,
	.setting-row .setting-label {
		min-width: 60px;
		color: #999;
	}

	.setting-row select {
		flex: 1;
		padding: 0.2rem 0.3rem;
		border: 1px solid #333;
		border-radius: 4px;
		background: #1a1a1a;
		color: #e0e0e0;
		font-size: 0.75rem;
		font-family: inherit;
	}

	.setting-val {
		color: #888;
		font-size: 0.75rem;
	}

	.hint {
		color: #a44;
		font-size: 0.65rem;
	}

	.start-btn {
		padding: 0.35rem 0.75rem;
		border: 1px solid #444;
		border-radius: 6px;
		background: transparent;
		color: #ccc;
		font-size: 0.75rem;
		cursor: pointer;
		font-family: inherit;
	}

	.start-btn:hover:not(:disabled) {
		border-color: #888;
		color: #fff;
	}

	.start-btn:disabled {
		opacity: 0.4;
		cursor: default;
	}
</style>
