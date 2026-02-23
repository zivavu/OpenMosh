<script lang="ts">
	import EffectsPanel from './EffectsPanel.svelte';
	import GlCanvas from './GlCanvas.svelte';
	import {
		EFFECT_DEFINITIONS,
		createEffectInstance,
		type EffectInstance,
	} from './effects';

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
	let effects: EffectInstance[] = $state(
		EFFECT_DEFINITIONS.map(createEffectInstance),
	);

	let moshMin = $state(3);
	let moshMax = $state(8);
	let showMoshSettings = $state(false);

	let undoStack: EffectInstance[][] = [];

	function mosh() {
		undoStack.push($state.snapshot(effects));

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
	}

	function undo() {
		if (undoStack.length === 0) return;
		effects = undoStack.pop()!;
	}

	function clearEffects() {
		undoStack.push($state.snapshot(effects));
		for (const effect of effects) {
			effect.enabled = false;
			const def = EFFECT_DEFINITIONS.find((d) => d.id === effect.defId);
			if (!def) continue;
			for (const param of def.params) {
				effect.values[param.key] = param.defaultValue;
			}
		}
	}

	function reInput() {
		if (!canvasEl) return;
		canvasEl.toBlob((blob) => {
			if (!blob) return;
			const newFile = new File([blob], `openmosh-reinput-${Date.now()}.png`, {
				type: 'image/png',
			});
			effects.forEach((e) => (e.enabled = false));
			undoStack.length = 0;
			onfile(newFile);
		}, 'image/png');
	}

	function handleKeydown(e: KeyboardEvent) {
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
			e.key.toLowerCase() === 'r' &&
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
</script>

<svelte:window onkeydown={handleKeydown} />

<!-- svelte-ignore a11y_no_static_element_interactions -->
<div
	class="editor"
	class:drag-over={dragging}
	ondragover={(e) => {
		e.preventDefault();
		dragging = true;
	}}
	ondragenter={(e) => {
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

		<GlCanvas {imageSrc} {effects} bind:canvasEl />

		<div class="action-bar">
			<div class="mosh-group">
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
		</div>
	</div>

	<EffectsPanel bind:effects />

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
