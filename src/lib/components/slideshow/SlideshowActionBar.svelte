<script lang="ts">
	import { HelpCircle, Pause, Play, Settings, Type } from 'lucide-svelte';
	import RecordGroup from '../editor/RecordGroup.svelte';
	import ResizeSettings from '../ui/ResizeSettings.svelte';
	import ShortcutsModal from '../ui/ShortcutsModal.svelte';
	import { TEXT_TIMELINE_SHORTCUTS } from '../../text';

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
		textEnabled = false,
		onToggleText,
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
			title: 'Effects',
			shortcuts: [
				{ keys: ['→'], description: 'Next mosh, or roll a new one' },
				{ keys: ['←'], description: 'Previous mosh' },
				{ keys: ['Ctrl/Cmd+Z'], description: 'Undo effect edit' },
				{
					keys: ['Ctrl/Cmd+Shift+Z', 'Ctrl/Cmd+Y'],
					description: 'Redo effect edit',
				},
			],
		},
		{
			title: 'Timeline editing',
			shortcuts: [
				{
					keys: ['Dbl-click', 'Ctrl+Click'],
					description: 'Create / split segment at cursor',
				},
				{ keys: ['Ctrl/Cmd+Z'], description: 'Undo (timeline takes priority)' },
				{ keys: ['Ctrl/Cmd+Shift+Z', 'Ctrl/Cmd+Y'], description: 'Redo' },
				{ keys: ['Shift+Drag'], description: 'Rectangle-select boundaries' },
				{ keys: ['Ctrl/Cmd+C'], description: 'Copy selected boundaries' },
				{ keys: ['Ctrl/Cmd+V'], description: 'Paste boundaries' },
				{ keys: ['Delete', 'Backspace'], description: 'Delete selection' },
				{ keys: ['Esc'], description: 'Cancel paste / clear selection' },
				{ keys: ['Shift+Scroll'], description: 'Pan timeline view' },
			],
		},
		TEXT_TIMELINE_SHORTCUTS,
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

	{#if onToggleText}
		<button
			class="icon-btn"
			class:on={textEnabled}
			onclick={onToggleText}
			title="Text timeline: timed text layers with their own effects"
			aria-label="Text timeline"
		>
			<Type size={14} />
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
				<div class="setting-row">
					<label for="ss-show-fps">Show FPS</label>
					<input id="ss-show-fps" type="checkbox" bind:checked={showFps} />
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
		border-top: 1px solid var(--line);
		flex-shrink: 0;
	}

	.action-btn {
		display: inline-flex;
		align-items: center;
		gap: 0.5rem;
		padding: 0.6rem 2rem;
		border: 1.5px solid var(--line-strong);
		border-radius: var(--r-pill);
		background: var(--glass);
		backdrop-filter: var(--blur);
		-webkit-backdrop-filter: var(--blur);
		color: var(--text-2);
		font-family: var(--font-mono);
		font-size: 0.7rem;
		font-weight: 600;
		letter-spacing: 0.14em;
		text-transform: uppercase;
		cursor: pointer;
		transition:
			border-color var(--t),
			color var(--t),
			background var(--t);
	}

	.action-btn:hover:not(:disabled) {
		border-color: var(--text-3);
		color: var(--text);
	}

	.action-btn:disabled {
		opacity: 0.4;
		cursor: default;
	}

	.play-btn:hover:not(:disabled) {
		border-color: var(--live-dim);
		color: var(--live);
		background: rgba(110, 231, 192, 0.1);
	}

	.icon-btn {
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
		flex-shrink: 0;
		padding: 0;
		transition:
			border-color var(--t),
			color var(--t);
	}

	.icon-btn:hover,
	.icon-btn.active {
		border-color: var(--text-3);
		color: var(--text);
	}

	/* Lit while the timeline is on, matching the editor's own text toggle. */
	.icon-btn.on {
		border-color: var(--live);
		color: var(--live);
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
		background: var(--raised);
		border: 1px solid var(--line-strong);
		border-radius: var(--r-3);
		padding: 0.75rem 1rem;
		display: flex;
		flex-direction: column;
		gap: 0.5rem;
		min-width: 200px;
		z-index: 20;
		box-shadow: 0 10px 34px rgba(0, 0, 0, 0.65);
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

	.setting-row input[type='checkbox'] {
		appearance: none;
		width: 14px;
		height: 14px;
		border: 1px solid var(--line-strong);
		border-radius: var(--r-1);
		background: var(--sunken);
		cursor: pointer;
		position: relative;
		flex-shrink: 0;
	}

	.setting-row input[type='checkbox']:hover {
		border-color: var(--text-3);
	}

	.setting-row input[type='checkbox']:checked {
		background: rgba(110, 231, 192, 0.15);
		border-color: var(--live-dim);
	}

	.setting-row input[type='checkbox']:checked::after {
		content: '';
		position: absolute;
		inset: 0;
		background: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 12 12'%3E%3Cpath d='M2.5 6l2.5 2.5 4.5-5' stroke='%236ee7c0' stroke-width='1.8' fill='none' stroke-linecap='round' stroke-linejoin='round'/%3E%3C/svg%3E")
			center/contain no-repeat;
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

	.setting-row input[type='range'] {
		flex: 1;
		height: 3px;
		appearance: none;
		background: rgba(255, 255, 255, 0.07);
		border-radius: 2px;
		outline: none;
		cursor: pointer;
	}

	.setting-row input[type='range']::-webkit-slider-thumb {
		appearance: none;
		width: 9px;
		height: 13px;
		border-radius: 1px;
		background: var(--text-2);
		cursor: pointer;
	}

	.setting-row input[type='range']::-moz-range-thumb {
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
