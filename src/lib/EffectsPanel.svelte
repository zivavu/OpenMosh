<script lang="ts">
	import EffectItem from './EffectItem.svelte';
	import {
		EFFECT_DEFINITIONS,
		createEffectInstance,
		type EffectInstance,
		getDefinition,
		loadPresets,
		savePreset,
		deletePreset,
		applyPreset,
		type Preset,
		type VolumeLink,
	} from './effects';

	export type SpectrumData = {
		data: Uint8Array;
		sampleRate: number;
		binCount: number;
	};

	interface Props {
		effects: EffectInstance[];
		hasTrack?: boolean;
		spectrumData?: SpectrumData | null;
		onVolumeLinkChange?: (index: number, paramKey: string, link: VolumeLink | null) => void;
	}

	let { effects = $bindable(), hasTrack = false, spectrumData = null, onVolumeLinkChange }: Props = $props();

	let presets: Preset[] = $state(loadPresets());
	let showPresets = $state(false);
	let saving = $state(false);
	let presetName = $state('');

	function handleSavePreset() {
		const name = presetName.trim();
		if (!name) return;
		presets = savePreset(name, $state.snapshot(effects));
		presetName = '';
		saving = false;
	}

	function handleLoadPreset(index: number) {
		effects = applyPreset(presets[index]);
	}

	function handleDeletePreset(index: number) {
		presets = deletePreset(index);
	}

	let dragFromIndex: number | null = $state(null);
	let dragOverIndex: number | null = $state(null);
	let dropPosition: 'above' | 'below' | null = $state(null);

	function toggle(index: number) {
		effects[index].enabled = !effects[index].enabled;
	}

	function toggleExpand(index: number) {
		effects[index].expanded = !effects[index].expanded;
	}

	function remove(index: number) {
		effects.splice(index, 1);
	}

	let hiddenDefs = $derived(
		EFFECT_DEFINITIONS.filter((def) => !effects.some((e) => e.defId === def.id)),
	);

	let showHidden = $state(false);

	function addEffect(defId: string) {
		const def = EFFECT_DEFINITIONS.find((d) => d.id === defId);
		if (!def) return;
		effects.push(createEffectInstance(def));
	}

	function paramChange(index: number, key: string, value: number | string) {
		effects[index].values[key] = value;
		if (!effects[index].enabled) effects[index].enabled = true;
	}

	function handleDragStart(index: number, e: DragEvent) {
		dragFromIndex = index;
		if (e.dataTransfer) {
			e.dataTransfer.effectAllowed = 'move';
			e.dataTransfer.setData('text/plain', String(index));
		}
	}

	function handleDragOver(index: number, e: DragEvent) {
		if (dragFromIndex === null || dragFromIndex === index) {
			dragOverIndex = null;
			dropPosition = null;
			return;
		}
		const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
		const midY = rect.top + rect.height / 2;
		dragOverIndex = index;
		dropPosition = e.clientY < midY ? 'above' : 'below';
	}

	function handleDragLeave(index: number) {
		if (dragOverIndex === index) {
			dragOverIndex = null;
			dropPosition = null;
		}
	}

	function handleDrop(index: number) {
		if (dragFromIndex === null || dragFromIndex === index) return;

		let targetIndex = index;
		if (dropPosition === 'below') targetIndex += 1;
		if (dragFromIndex < targetIndex) targetIndex -= 1;

		const [moved] = effects.splice(dragFromIndex, 1);
		effects.splice(targetIndex, 0, moved);
		clearDragState();
	}

	function clearDragState() {
		dragFromIndex = null;
		dragOverIndex = null;
		dropPosition = null;
	}

	function getDropIndicator(index: number): 'above' | 'below' | null {
		if (dragOverIndex !== index) return null;
		return dropPosition;
	}
</script>

<aside class="effects-panel">
	<div class="presets-section">
		<button class="presets-header" onclick={() => (showPresets = !showPresets)}>
			<span class="presets-arrow" class:expanded={showPresets}>&#9654;</span>
			<span>Presets{presets.length > 0 ? ` (${presets.length})` : ''}</span>
		</button>

		{#if showPresets}
			<div class="presets-body">
				{#if saving}
					<!-- svelte-ignore a11y_autofocus -->
					<form
						class="preset-save-row"
						onsubmit={(e) => {
							e.preventDefault();
							handleSavePreset();
						}}
					>
						<input
							class="preset-name-input"
							type="text"
							placeholder="Preset name..."
							bind:value={presetName}
							autofocus
						/>
						<button class="preset-confirm-btn" type="submit" title="Save">
							<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
								<polyline points="20 6 9 17 4 12" />
							</svg>
						</button>
						<button
							class="preset-cancel-btn"
							type="button"
							onclick={() => {
								saving = false;
								presetName = '';
							}}
							title="Cancel"
						>
							<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
								<path d="M18 6L6 18" />
								<path d="M6 6l12 12" />
							</svg>
						</button>
					</form>
				{:else}
					<button
						class="preset-save-trigger"
						onclick={() => (saving = true)}
					>
						<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
							<line x1="12" y1="5" x2="12" y2="19" />
							<line x1="5" y1="12" x2="19" y2="12" />
						</svg>
						Save current
					</button>
				{/if}

				{#each presets as preset, i (i)}
					<div class="preset-item">
						<button
							class="preset-load-btn"
							onclick={() => handleLoadPreset(i)}
							title="Load preset"
						>
							{preset.name}
						</button>
						<button
							class="preset-delete-btn"
							onclick={() => handleDeletePreset(i)}
							title="Delete preset"
						>
							<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
								<path d="M18 6L6 18" />
								<path d="M6 6l12 12" />
							</svg>
						</button>
					</div>
				{/each}

				{#if presets.length === 0 && !saving}
					<div class="preset-empty">No saved presets</div>
				{/if}
			</div>
		{/if}
	</div>

	<div class="panel-scroll">
		{#each effects as effect, i (effect.instanceId)}
			<EffectItem
				{effect}
				hasTrack={hasTrack}
				{spectrumData}
				onVolumeLinkChange={onVolumeLinkChange ? (key, link) => onVolumeLinkChange(i, key, link) : undefined}
				onToggle={() => toggle(i)}
				onToggleExpand={() => toggleExpand(i)}
				onRemove={() => remove(i)}
				onParamChange={(key, value) => paramChange(i, key, value)}
				isDragging={dragFromIndex === i}
				dropIndicator={getDropIndicator(i)}
				onDragStart={(e) => handleDragStart(i, e)}
				onDragOver={(e) => handleDragOver(i, e)}
				onDragLeave={() => handleDragLeave(i)}
				onDrop={() => handleDrop(i)}
				onDragEnd={clearDragState}
			/>
		{/each}

		{#if hiddenDefs.length > 0}
			<button class="hidden-header" onclick={() => (showHidden = !showHidden)}>
				<span class="hidden-arrow" class:expanded={showHidden}>&#9654;</span>
				<span>Hidden Effects ({hiddenDefs.length})</span>
			</button>

			{#if showHidden}
				<div class="hidden-list">
					{#each hiddenDefs as def (def.id)}
						<div class="hidden-item">
							<span class="hidden-name">{def.name}</span>
							<button class="add-btn" onclick={() => addEffect(def.id)} title="Add to chain">
								<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
									<line x1="12" y1="5" x2="12" y2="19" />
									<line x1="5" y1="12" x2="19" y2="12" />
								</svg>
							</button>
						</div>
					{/each}
				</div>
			{/if}
		{/if}
	</div>
</aside>

<style>
	.effects-panel {
		width: 280px;
		height: 100%;
		background: #161616;
		border-left: 1px solid #1e1e1e;
		display: flex;
		flex-direction: column;
		flex-shrink: 0;
	}

	.presets-section {
		border-bottom: 1px solid #222;
		flex-shrink: 0;
	}

	.presets-header {
		display: flex;
		align-items: center;
		gap: 0.5rem;
		width: 100%;
		padding: 0.6rem 0.8rem;
		background: none;
		border: none;
		color: #666;
		font-size: 0.72rem;
		font-weight: 500;
		font-family: inherit;
		letter-spacing: 0.03em;
		cursor: pointer;
		transition: color 0.15s;
	}

	.presets-header:hover {
		color: #999;
	}

	.presets-arrow {
		font-size: 0.5rem;
		transition: transform 0.15s;
	}

	.presets-arrow.expanded {
		transform: rotate(90deg);
	}

	.presets-body {
		padding: 0 0.6rem 0.5rem;
		display: flex;
		flex-direction: column;
		gap: 0.25rem;
	}

	.preset-save-trigger {
		display: flex;
		align-items: center;
		gap: 0.4rem;
		padding: 0.35rem 0.5rem;
		background: none;
		border: 1px dashed #333;
		border-radius: 4px;
		color: #555;
		font-size: 0.7rem;
		font-family: inherit;
		cursor: pointer;
		transition:
			color 0.15s,
			border-color 0.15s;
	}

	.preset-save-trigger:hover {
		color: #999;
		border-color: #555;
	}

	.preset-save-row {
		display: flex;
		gap: 0.25rem;
	}

	.preset-name-input {
		flex: 1;
		min-width: 0;
		padding: 0.3rem 0.5rem;
		background: #111;
		border: 1px solid #333;
		border-radius: 4px;
		color: #ccc;
		font-size: 0.7rem;
		font-family: inherit;
		outline: none;
	}

	.preset-name-input:focus {
		border-color: #555;
	}

	.preset-confirm-btn,
	.preset-cancel-btn {
		display: flex;
		align-items: center;
		justify-content: center;
		width: 26px;
		height: 26px;
		background: none;
		border: 1px solid #333;
		border-radius: 4px;
		color: #666;
		cursor: pointer;
		padding: 0;
		transition:
			color 0.15s,
			border-color 0.15s;
	}

	.preset-confirm-btn:hover {
		color: #8c8;
		border-color: #585;
	}

	.preset-cancel-btn:hover {
		color: #c88;
		border-color: #855;
	}

	.preset-item {
		display: flex;
		align-items: center;
		gap: 0.25rem;
	}

	.preset-load-btn {
		flex: 1;
		padding: 0.35rem 0.5rem;
		background: rgba(255, 255, 255, 0.03);
		border: 1px solid #2a2a2a;
		border-radius: 4px;
		color: #888;
		font-size: 0.7rem;
		font-family: inherit;
		text-align: left;
		cursor: pointer;
		white-space: nowrap;
		overflow: hidden;
		text-overflow: ellipsis;
		transition:
			color 0.15s,
			border-color 0.15s,
			background 0.15s;
	}

	.preset-load-btn:hover {
		color: #ccc;
		border-color: #444;
		background: rgba(255, 255, 255, 0.06);
	}

	.preset-delete-btn {
		display: flex;
		align-items: center;
		justify-content: center;
		width: 22px;
		height: 22px;
		background: none;
		border: none;
		color: #444;
		cursor: pointer;
		border-radius: 3px;
		padding: 0;
		flex-shrink: 0;
		transition:
			color 0.15s,
			background 0.15s;
	}

	.preset-delete-btn:hover {
		color: #c66;
		background: rgba(255, 80, 80, 0.08);
	}

	.preset-empty {
		font-size: 0.68rem;
		color: #444;
		padding: 0.2rem 0.5rem;
	}

	.panel-scroll {
		flex: 1;
		overflow-y: auto;
		overflow-x: hidden;
	}

	.panel-scroll::-webkit-scrollbar {
		width: 4px;
	}

	.panel-scroll::-webkit-scrollbar-track {
		background: transparent;
	}

	.panel-scroll::-webkit-scrollbar-thumb {
		background: #333;
		border-radius: 2px;
	}

	.panel-scroll::-webkit-scrollbar-thumb:hover {
		background: #555;
	}

	.hidden-header {
		display: flex;
		align-items: center;
		gap: 0.5rem;
		width: 100%;
		padding: 0.6rem 0.8rem;
		background: none;
		border: none;
		border-top: 1px solid #222;
		color: #666;
		font-size: 0.72rem;
		font-weight: 500;
		font-family: inherit;
		letter-spacing: 0.03em;
		cursor: pointer;
		transition: color 0.15s;
	}

	.hidden-header:hover {
		color: #999;
	}

	.hidden-arrow {
		font-size: 0.5rem;
		transition: transform 0.15s;
	}

	.hidden-arrow.expanded {
		transform: rotate(90deg);
	}

	.hidden-list {
		border-top: 1px solid #1e1e1e;
	}

	.hidden-item {
		display: flex;
		align-items: center;
		padding: 0.35rem 0.8rem;
		border-bottom: 1px solid #1a1a1a;
	}

	.hidden-item:hover {
		background: rgba(255, 255, 255, 0.02);
	}

	.hidden-name {
		flex: 1;
		font-size: 0.75rem;
		color: #555;
	}

	.add-btn {
		display: flex;
		align-items: center;
		justify-content: center;
		width: 22px;
		height: 22px;
		background: none;
		border: none;
		color: #444;
		cursor: pointer;
		border-radius: 3px;
		padding: 0;
		transition: color 0.15s, background 0.15s;
	}

	.add-btn:hover {
		color: #aaa;
		background: rgba(255, 255, 255, 0.05);
	}
</style>
