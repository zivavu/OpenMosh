<script lang="ts">
	import EffectsPanel from './EffectsPanel.svelte';
	import GlCanvas from './GlCanvas.svelte';
	import {
		EFFECT_DEFINITIONS,
		createEffectInstance,
		type EffectInstance,
	} from './effects';
	import { recordVideo, downloadBlob, type RecordFormat } from './recorder';
	import type { GlRenderer } from './gl/renderer';

	interface Props {
		file: File;
		onBack: () => void;
		onfile: (f: File) => void;
	}

	let { file, onBack, onfile }: Props = $props();
	let dragging = $state(false);

	let format: 'png' | 'jpg' = $state('png');
	let imageSrc = $derived(URL.createObjectURL(file));
	let canvasEl: HTMLCanvasElement | null = $state(null);
	let glRenderer: GlRenderer | null = $state(null);
	let effects: EffectInstance[] = $state(
		EFFECT_DEFINITIONS.map(createEffectInstance),
	);

	let moshMin = $state(3);
	let moshMax = $state(8);
	let randomizeOrder = $state(true);
	let showMoshSettings = $state(false);

	let history: EffectInstance[][] = $state([
		$state.snapshot(EFFECT_DEFINITIONS.map(createEffectInstance)),
	]);
	let historyIndex = $state(0);
	let canUndo = $derived(historyIndex > 0);
	let canRedo = $derived(historyIndex < history.length - 1);
	let moshGroupEl: HTMLDivElement;

	function handleClickOutside(e: MouseEvent) {
		if (
			showMoshSettings &&
			moshGroupEl &&
			!moshGroupEl.contains(e.target as Node)
		) {
			showMoshSettings = false;
		}
	}

	function pushHistory() {
		history.length = historyIndex + 1;
		history.push($state.snapshot(effects));
		historyIndex = history.length - 1;
	}

	function generateMosh() {
		const moshable = effects.filter((e) => !e.locked);
		const clampedMin = Math.min(moshMin, moshable.length);
		const clampedMax = Math.min(moshMax, moshable.length);
		const target =
			clampedMin + Math.floor(Math.random() * (clampedMax - clampedMin + 1));

		const indices = moshable.map((_, i) => i);
		for (let i = indices.length - 1; i > 0; i--) {
			const j = Math.floor(Math.random() * (i + 1));
			[indices[i], indices[j]] = [indices[j], indices[i]];
		}
		const enabledSet = new Set(indices.slice(0, target));

		moshable.forEach((effect, i) => {
			effect.enabled = enabledSet.has(i);
			if (!effect.enabled) return;
			const def = EFFECT_DEFINITIONS.find((d) => d.id === effect.defId);
			if (!def) return;
			for (const param of def.params) {
				if (param.type === 'range') {
					const lo = param.moshMin ?? param.min;
					const hi = param.moshMax ?? param.max;
					const range = hi - lo;
					const bias = 0.15 + Math.random() * 0.55;
					effect.values[param.key] =
						Math.round((lo + bias * range) / param.step) * param.step;
				} else if (param.type === 'select') {
					const options = param.options;
					effect.values[param.key] =
						options[Math.floor(Math.random() * options.length)].value;
				}
			}
		});

		if (randomizeOrder) {
			const moshableIndices = effects
				.map((e, i) => (e.locked ? -1 : i))
				.filter((i) => i !== -1);
			const shuffled = [...moshableIndices];
			for (let i = shuffled.length - 1; i > 0; i--) {
				const j = Math.floor(Math.random() * (i + 1));
				[shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
			}
			const snapshot = effects.map((e) => $state.snapshot(e));
			for (let k = 0; k < moshableIndices.length; k++) {
				effects[moshableIndices[k]] = snapshot[shuffled[k]];
			}
		}

		pushHistory();
	}

	function mosh() {
		if (canRedo) {
			historyIndex++;
			effects = $state.snapshot(history[historyIndex]) as EffectInstance[];
		} else {
			generateMosh();
		}
	}

	function undo() {
		if (!canUndo) return;
		historyIndex--;
		effects = $state.snapshot(history[historyIndex]) as EffectInstance[];
	}

	function clearEffects() {
		for (const effect of effects) {
			effect.enabled = false;
			const def = EFFECT_DEFINITIONS.find((d) => d.id === effect.defId);
			if (!def) continue;
			for (const param of def.params) {
				effect.values[param.key] = param.defaultValue;
			}
		}
		pushHistory();
	}

	function reInput() {
		if (!canvasEl) return;
		canvasEl.toBlob((blob) => {
			if (!blob) return;
			const newFile = new File([blob], `openmosh-reinput-${Date.now()}.png`, {
				type: 'image/png',
			});
			effects.forEach((e) => (e.enabled = false));
			history = [$state.snapshot(effects)];
			historyIndex = 0;
			onfile(newFile);
		}, 'image/png');
	}

	function handleKeydown(e: KeyboardEvent) {
		if (e.key === 's' && (e.ctrlKey || e.metaKey)) {
			e.preventDefault();
			save();
			return;
		}

		const el = e.target as HTMLElement;
		if (
			el.tagName === 'INPUT' ||
			el.tagName === 'TEXTAREA' ||
			el.tagName === 'SELECT' ||
			el.isContentEditable
		)
			return;

		if (e.key === 'ArrowRight') {
			e.preventDefault();
			mosh();
		} else if (
			e.key === 'ArrowLeft' ||
			(e.key === 'z' && (e.ctrlKey || e.metaKey))
		) {
			e.preventDefault();
			undo();
		} else if (
			e.key.toLowerCase() === 'v' &&
			!e.ctrlKey &&
			!e.metaKey &&
			!e.altKey
		) {
			e.preventDefault();
			reInput();
		}
	}

	function save() {
		if (!canvasEl) return;
		const mimeType = format === 'jpg' ? 'image/jpeg' : 'image/png';
		const ext = format === 'jpg' ? 'jpg' : 'png';
		canvasEl.toBlob(
			(blob) => {
				if (!blob) return;
				const url = URL.createObjectURL(blob);
				const a = document.createElement('a');
				a.href = url;
				a.download = `openmosh-${Date.now()}.${ext}`;
				a.click();
				URL.revokeObjectURL(url);
			},
			mimeType,
			format === 'jpg' ? 0.92 : undefined,
		);
	}

	let showRecordSettings = $state(false);
	let recordFormat: RecordFormat = $state('mp4');
	let recordDuration = $state(5);
	let recordFps = $state(24);
	let recording = $state(false);
	let recordProgress = $state(0);
	let recordAbort: AbortController | null = $state(null);
	let recordGroupEl: HTMLDivElement;

	function handleRecordClickOutside(e: MouseEvent) {
		if (showRecordSettings && recordGroupEl && !recordGroupEl.contains(e.target as Node)) {
			showRecordSettings = false;
		}
	}

	async function startRecording() {
		if (!canvasEl || !glRenderer || recording) return;
		showRecordSettings = false;
		recording = true;
		recordProgress = 0;
		const abort = new AbortController();
		recordAbort = abort;

		try {
			const blob = await recordVideo({
				format: recordFormat,
				duration: recordDuration,
				fps: recordFormat === 'gif' ? Math.min(recordFps, 15) : recordFps,
				canvas: canvasEl,
				renderer: glRenderer,
				effects: $state.snapshot(effects) as EffectInstance[],
				onProgress: (p) => { recordProgress = p; },
				signal: abort.signal,
			});
			downloadBlob(blob, recordFormat);
		} catch (e) {
			if (e instanceof DOMException && e.name === 'AbortError') {
				// cancelled
			} else {
				console.error('Recording failed:', e);
				alert(e instanceof Error ? e.message : 'Recording failed. Check the browser console for details.');
			}
		} finally {
			recording = false;
			recordAbort = null;
			if (canvasEl && glRenderer) {
				glRenderer.render(effects, performance.now() / 1000);
			}
		}
	}

	function cancelRecording() {
		recordAbort?.abort();
	}
</script>

<svelte:window onkeydown={handleKeydown} onpointerdown={(e) => { handleClickOutside(e); handleRecordClickOutside(e); }} />

<!-- svelte-ignore a11y_no_static_element_interactions -->
<div
	class="editor"
	class:drag-over={dragging}
	ondragover={(e) => {
		if (!e.dataTransfer?.types.includes('Files')) return;
		e.preventDefault();
		dragging = true;
	}}
	ondragenter={(e) => {
		if (!e.dataTransfer?.types.includes('Files')) return;
		e.preventDefault();
		dragging = true;
	}}
	ondragleave={(e) => {
		if (
			e.currentTarget === e.target ||
			!e.currentTarget.contains(e.relatedTarget as Node)
		)
			dragging = false;
	}}
	ondrop={(e) => {
		e.preventDefault();
		dragging = false;
		const f = e.dataTransfer?.files[0];
		if (f && f.type.startsWith('image/')) onfile(f);
	}}
>
	<div class="main-area">
		<div class="toolbar">
			<button class="back-btn" onclick={onBack} title="Load different file">
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
					<line x1="19" y1="12" x2="5" y2="12" />
					<polyline points="12 19 5 12 12 5" />
				</svg>
			</button>
			<div class="format-group">
				<button
					class="format-btn"
					class:active={format === 'png'}
					onclick={() => (format = 'png')}
				>
					PNG
				</button>
				<button
					class="format-btn"
					class:active={format === 'jpg'}
					onclick={() => (format = 'jpg')}
				>
					JPG
				</button>
			</div>
		</div>

		<GlCanvas {imageSrc} {effects} bind:canvasEl bind:glRenderer />

		<div class="action-bar">
			<div class="mosh-group" bind:this={moshGroupEl}>
				<button
					class="settings-btn"
					class:active={showMoshSettings}
					onclick={() => (showMoshSettings = !showMoshSettings)}
					title="Mosh settings"
				>
					<svg
						width="14"
						height="14"
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
				</button>
				<button
					class="settings-btn"
					onclick={clearEffects}
					title="Clear all effects"
				>
					<svg
						width="14"
						height="14"
						viewBox="0 0 24 24"
						fill="none"
						stroke="currentColor"
						stroke-width="2"
						stroke-linecap="round"
						stroke-linejoin="round"
					>
						<path d="M18 6L6 18" />
						<path d="M6 6l12 12" />
					</svg>
				</button>
				<button
					class="settings-btn"
					onclick={undo}
					disabled={!canUndo}
					title="Undo (← / Ctrl+Z)"
				>
					<svg
						width="14"
						height="14"
						viewBox="0 0 24 24"
						fill="none"
						stroke="currentColor"
						stroke-width="2"
						stroke-linecap="round"
						stroke-linejoin="round"
					>
						<polyline points="1 4 1 10 7 10" />
						<path d="M3.51 15a9 9 0 1 0 2.13-9.36L1 10" />
					</svg>
				</button>
				<button class="action-btn mosh-btn" onclick={mosh}>
					<svg
						width="16"
						height="16"
						viewBox="0 0 24 24"
						fill="none"
						stroke="currentColor"
						stroke-width="2.5"
						stroke-linecap="round"
						stroke-linejoin="round"
					>
						<polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2" />
					</svg>
					MOSH
				</button>

				{#if showMoshSettings}
					<div class="mosh-settings">
						<div class="mosh-setting-row">
							<label for="mosh-min">Min effects</label>
							<input
								id="mosh-min"
								type="range"
								min="1"
								max="20"
								step="1"
								bind:value={moshMin}
								oninput={() => {
									if (moshMax < moshMin) moshMax = moshMin;
								}}
							/>
							<span class="mosh-setting-val">{moshMin}</span>
						</div>
						<div class="mosh-setting-row">
							<label for="mosh-max">Max effects</label>
							<input
								id="mosh-max"
								type="range"
								min="1"
								max="20"
								step="1"
								bind:value={moshMax}
								oninput={() => {
									if (moshMin > moshMax) moshMin = moshMax;
								}}
							/>
							<span class="mosh-setting-val">{moshMax}</span>
						</div>
						<div class="mosh-setting-row">
							<label for="mosh-shuffle">Shuffle order</label>
							<input
								id="mosh-shuffle"
								type="checkbox"
								bind:checked={randomizeOrder}
							/>
						</div>
					</div>
				{/if}
			</div>
			<button class="action-btn save-btn" onclick={save}>
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
					<path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
					<polyline points="7 10 12 15 17 10" />
					<line x1="12" y1="15" x2="12" y2="3" />
				</svg>
				SAVE
			</button>

			<div class="record-group" bind:this={recordGroupEl}>
				<button
					class="action-btn record-btn"
					onclick={() => (showRecordSettings = !showRecordSettings)}
					disabled={recording}
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
						<circle cx="12" cy="12" r="10" />
						<circle cx="12" cy="12" r="4" fill="currentColor" />
					</svg>
					RECORD
				</button>

				{#if showRecordSettings}
					<div class="record-settings">
						<div class="mosh-setting-row">
							<label for="rec-format">Format</label>
							<select id="rec-format" bind:value={recordFormat}>
								<option value="mp4">MP4</option>
								<option value="webm">WebM</option>
								<option value="gif">GIF</option>
							</select>
						</div>
						<div class="mosh-setting-row">
							<label for="rec-duration">Duration</label>
							<input
								id="rec-duration"
								type="range"
								min="1"
								max="30"
								step="1"
								bind:value={recordDuration}
							/>
							<span class="mosh-setting-val">{recordDuration}s</span>
						</div>
						<div class="mosh-setting-row">
							<label for="rec-fps">FPS</label>
							<select id="rec-fps" bind:value={recordFps}>
								<option value={15}>15</option>
								<option value={24}>24</option>
								<option value={30}>30</option>
								<option value={60}>60</option>
								<option value={120}>120</option>
							</select>
							{#if recordFormat === 'gif' && recordFps > 15}
								<span class="rec-hint">capped to 15</span>
							{/if}
						</div>
						<button class="rec-start-btn" onclick={startRecording}>
							Start Recording
						</button>
					</div>
				{/if}
			</div>
		</div>
	</div>

	<EffectsPanel bind:effects />

	{#if recording}
		<div class="record-overlay">
			<div class="record-modal">
				<p class="record-title">Recording {recordFormat.toUpperCase()}...</p>
				<div class="progress-track">
					<div class="progress-fill" style="width: {Math.round(recordProgress * 100)}%"></div>
				</div>
				<p class="record-pct">{Math.round(recordProgress * 100)}%</p>
				<button class="rec-cancel-btn" onclick={cancelRecording}>Cancel</button>
			</div>
		</div>
	{/if}

	{#if dragging}
		<div class="drop-overlay">
			<span>Drop image to replace</span>
		</div>
	{/if}
</div>

<style>
	.editor {
		display: flex;
		height: 100%;
		width: 100%;
		overflow: hidden;
	}

	.main-area {
		flex: 1;
		display: flex;
		flex-direction: column;
		position: relative;
		min-width: 0;
	}

	/* Toolbar */
	.toolbar {
		position: absolute;
		top: 0;
		left: 0;
		z-index: 10;
		display: flex;
		align-items: center;
		gap: 0.5rem;
		padding: 0.75rem;
	}

	.back-btn {
		display: flex;
		align-items: center;
		justify-content: center;
		width: 32px;
		height: 32px;
		background: rgba(30, 30, 30, 0.85);
		border: 1px solid #333;
		border-radius: 6px;
		color: #aaa;
		cursor: pointer;
		transition:
			color 0.15s,
			border-color 0.15s;
	}

	.back-btn:hover {
		color: #fff;
		border-color: #555;
	}

	.format-group {
		display: flex;
		background: rgba(30, 30, 30, 0.85);
		border: 1px solid #333;
		border-radius: 6px;
		overflow: hidden;
	}

	.format-btn {
		padding: 0.35rem 0.9rem;
		font-size: 0.7rem;
		font-weight: 600;
		letter-spacing: 0.06em;
		font-family: inherit;
		background: none;
		border: none;
		color: #777;
		cursor: pointer;
		transition:
			color 0.15s,
			background 0.15s;
	}

	.format-btn:not(:last-child) {
		border-right: 1px solid #333;
	}

	.format-btn.active {
		color: #ddd;
		background: rgba(255, 255, 255, 0.06);
	}

	.format-btn:hover {
		color: #ccc;
	}

	/* Action bar */
	.action-bar {
		display: flex;
		justify-content: center;
		gap: 0.75rem;
		padding: 1rem;
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
		font-size: 0.78rem;
		font-weight: 600;
		letter-spacing: 0.08em;
		font-family: inherit;
		cursor: pointer;
		transition:
			border-color 0.2s,
			color 0.2s,
			background 0.2s;
	}

	.action-btn:hover {
		border-color: #888;
		color: #fff;
		background: rgba(255, 255, 255, 0.04);
	}

	.mosh-btn:hover {
		border-color: #a89050;
		color: #f0d878;
	}

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
		background: none;
		border: 1.5px solid #444;
		color: #888;
		cursor: pointer;
		transition:
			border-color 0.2s,
			color 0.2s;
	}

	.settings-btn:hover,
	.settings-btn.active {
		border-color: #777;
		color: #ccc;
	}

	.settings-btn:disabled {
		opacity: 0.3;
		cursor: default;
		pointer-events: none;
	}

	.mosh-settings {
		position: absolute;
		bottom: calc(100% + 0.5rem);
		left: 50%;
		transform: translateX(-50%);
		background: #1a1a1a;
		border: 1px solid #333;
		border-radius: 8px;
		padding: 0.75rem 1rem;
		display: flex;
		flex-direction: column;
		gap: 0.5rem;
		min-width: 210px;
		z-index: 20;
		box-shadow: 0 4px 16px rgba(0, 0, 0, 0.5);
	}

	.mosh-setting-row {
		display: flex;
		align-items: center;
		gap: 0.5rem;
	}

	.mosh-setting-row label {
		font-size: 0.7rem;
		color: #888;
		min-width: 72px;
		flex-shrink: 0;
	}

	.mosh-setting-row input[type='range'] {
		flex: 1;
		height: 3px;
		appearance: none;
		background: #333;
		border-radius: 2px;
		outline: none;
		cursor: pointer;
	}

	.mosh-setting-row input[type='range']::-webkit-slider-thumb {
		appearance: none;
		width: 10px;
		height: 10px;
		border-radius: 50%;
		background: #aaa;
		cursor: pointer;
	}

	.mosh-setting-row input[type='checkbox'] {
		appearance: none;
		width: 14px;
		height: 14px;
		border: 1px solid #555;
		border-radius: 2px;
		background: #1a1a1a;
		cursor: pointer;
		position: relative;
		flex-shrink: 0;
	}

	.mosh-setting-row input[type='checkbox']:hover {
		border-color: #777;
	}

	.mosh-setting-row input[type='checkbox']:checked {
		background: #555;
		border-color: #888;
	}

	.mosh-setting-row input[type='checkbox']:checked::after {
		content: '';
		position: absolute;
		inset: 0;
		width: 100%;
		height: 100%;
		background: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 12 12'%3E%3Cpath d='M2.5 6l2.5 2.5 4.5-5' stroke='%23ddd' stroke-width='1.8' fill='none' stroke-linecap='round' stroke-linejoin='round'/%3E%3C/svg%3E")
			center/contain no-repeat;
	}

	.mosh-setting-val {
		font-size: 0.7rem;
		color: #999;
		min-width: 20px;
		text-align: right;
		font-variant-numeric: tabular-nums;
	}

	.editor.drag-over::before {
		content: '';
		position: absolute;
		inset: 0;
		z-index: 99;
		border: 2px dashed #888;
		border-radius: 8px;
		pointer-events: none;
	}

	/* Record button & settings */
	.record-group {
		position: relative;
		display: flex;
		align-items: center;
	}

	.record-btn:hover {
		border-color: #c05050;
		color: #ff8888;
	}

	.record-settings {
		position: absolute;
		bottom: calc(100% + 0.5rem);
		right: 0;
		background: #1a1a1a;
		border: 1px solid #333;
		border-radius: 8px;
		padding: 0.75rem 1rem;
		display: flex;
		flex-direction: column;
		gap: 0.5rem;
		min-width: 230px;
		z-index: 20;
		box-shadow: 0 4px 16px rgba(0, 0, 0, 0.5);
	}

	.record-settings select {
		flex: 1;
		background: #1a1a1a;
		color: #aaa;
		border: 1px solid #333;
		border-radius: 4px;
		padding: 0.2rem 0.4rem;
		font-size: 0.7rem;
		font-family: inherit;
		cursor: pointer;
		outline: none;
	}

	.record-settings select:focus {
		border-color: #555;
	}

	.rec-hint {
		font-size: 0.6rem;
		color: #886;
		white-space: nowrap;
	}

	.rec-start-btn {
		margin-top: 0.25rem;
		padding: 0.45rem 1rem;
		border: 1.5px solid #c05050;
		border-radius: 6px;
		background: rgba(192, 80, 80, 0.1);
		color: #e88;
		font-size: 0.72rem;
		font-weight: 600;
		font-family: inherit;
		letter-spacing: 0.04em;
		cursor: pointer;
		transition: background 0.15s, color 0.15s;
	}

	.rec-start-btn:hover {
		background: rgba(192, 80, 80, 0.2);
		color: #faa;
	}

	/* Recording overlay */
	.record-overlay {
		position: absolute;
		inset: 0;
		z-index: 100;
		display: flex;
		align-items: center;
		justify-content: center;
		background: rgba(0, 0, 0, 0.7);
	}

	.record-modal {
		display: flex;
		flex-direction: column;
		align-items: center;
		gap: 0.75rem;
		padding: 2rem 3rem;
		background: #1a1a1a;
		border: 1px solid #333;
		border-radius: 12px;
		box-shadow: 0 8px 32px rgba(0, 0, 0, 0.6);
	}

	.record-title {
		font-size: 0.9rem;
		font-weight: 600;
		color: #ddd;
		letter-spacing: 0.04em;
	}

	.progress-track {
		width: 200px;
		height: 4px;
		background: #333;
		border-radius: 2px;
		overflow: hidden;
	}

	.progress-fill {
		height: 100%;
		background: #c05050;
		border-radius: 2px;
		transition: width 0.15s;
	}

	.record-pct {
		font-size: 0.75rem;
		color: #999;
		font-variant-numeric: tabular-nums;
	}

	.rec-cancel-btn {
		padding: 0.35rem 1.2rem;
		border: 1px solid #444;
		border-radius: 6px;
		background: none;
		color: #999;
		font-size: 0.7rem;
		font-family: inherit;
		cursor: pointer;
		transition: color 0.15s, border-color 0.15s;
	}

	.rec-cancel-btn:hover {
		color: #ddd;
		border-color: #666;
	}

	.drop-overlay {
		position: absolute;
		inset: 0;
		z-index: 100;
		display: flex;
		align-items: center;
		justify-content: center;
		background: rgba(0, 0, 0, 0.6);
		pointer-events: none;
	}

	.drop-overlay span {
		font-size: 1.2rem;
		font-weight: 600;
		color: #ccc;
		letter-spacing: 0.04em;
	}
</style>
