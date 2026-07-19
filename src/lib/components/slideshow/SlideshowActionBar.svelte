<script lang="ts">
	import { HelpCircle, Pause, Play, Settings } from 'lucide-svelte';
	import RecordGroup from '../editor/RecordGroup.svelte';
	import ResizeSettings from '../ui/ResizeSettings.svelte';
	import ShortcutsModal from '../ui/ShortcutsModal.svelte';

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
		onTogglePreview,
		onStartRecording,
		onRecordFpsChange,
		onRecordDurationChange,
	}: Props = $props();

	const isMobile = window.matchMedia('(pointer: coarse)').matches;
	let showOptionsPanel = $state(false);
	let showRecordSettings = $state(false);
	let showShortcuts = $state(false);

	const shortcutGroups = [
		{
			title: 'Preview',
			shortcuts: [
				{ keys: ['Space'], description: 'Play / pause preview' },
				{ keys: ['Esc'], description: 'Stop preview' },
			],
		},
		{
			title: 'Timeline Editing',
			shortcuts: [
				{ keys: ['Ctrl/Cmd+Z'], description: 'Undo' },
				{ keys: ['Ctrl/Cmd+Shift+Z', 'Ctrl/Cmd+Y'], description: 'Redo' },
				{ keys: ['Shift+Drag'], description: 'Rectangle-select boundaries' },
				{ keys: ['Ctrl/Cmd+C'], description: 'Copy selected boundaries' },
				{ keys: ['Ctrl/Cmd+V'], description: 'Paste boundaries' },
				{ keys: ['Delete', 'Backspace'], description: 'Delete selection' },
				{ keys: ['Esc'], description: 'Cancel paste / clear selection' },
				{ keys: ['Shift+Scroll'], description: 'Pan timeline view' },
			],
		},
	];
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
		window.addEventListener('pointerdown', handlePointerDown);
		return () => window.removeEventListener('pointerdown', handlePointerDown);
	});
</script>

<div class="action-bar">
	{#if !isMobile}
		<button
			class="icon-btn"
			onclick={() => (showShortcuts = true)}
			title="Keyboard shortcuts"
			aria-label="Keyboard shortcuts"
		>
			<HelpCircle size={14} />
		</button>
	{/if}

	<div class="options-group" bind:this={optionsGroupEl}>
		<button
			class="icon-btn options-btn"
			class:active={showOptionsPanel}
			onclick={() => (showOptionsPanel = !showOptionsPanel)}
			title="Options"
			aria-label="Options"
		>
			<Settings size={14} />
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
			<Pause size={16} fill="currentColor" stroke="none" />
			STOP
		{:else}
			<Play size={16} fill="currentColor" stroke="none" />
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
							onRecordDurationChange(+(e.currentTarget as HTMLInputElement).value)}
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
				Start Recording{trackFile ? '' : ' (silent)'}
			</button>
		{/snippet}
	</RecordGroup>
	{/if}
</div>

{#if showShortcuts}
	<ShortcutsModal groups={shortcutGroups} onClose={() => (showShortcuts = false)} />
{/if}

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

	.icon-btn {
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
		flex-shrink: 0;
		padding: 0;
		transition: border-color 0.2s, color 0.2s;
	}

	.icon-btn:hover,
	.icon-btn.active {
		border-color: #777;
		color: #ccc;
	}

	.options-group {
		position: relative;
		display: flex;
		align-items: center;
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

	.setting-row input[type='range'] {
		flex: 1;
		height: 3px;
		appearance: none;
		background: #333;
		border-radius: 2px;
		outline: none;
		cursor: pointer;
	}

	.setting-row input[type='range']::-webkit-slider-thumb {
		appearance: none;
		width: 10px;
		height: 10px;
		border-radius: 50%;
		background: #aaa;
		cursor: pointer;
	}

	.setting-row input[type='range']::-moz-range-thumb {
		width: 10px;
		height: 10px;
		border-radius: 50%;
		background: #aaa;
		border: none;
		cursor: pointer;
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
