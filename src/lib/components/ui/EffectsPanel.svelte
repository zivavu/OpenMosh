<script lang="ts">
	import { tick } from 'svelte';
	import { Check, Plus, Save, Search, X } from 'lucide-svelte';
	import {
		EFFECT_DEFINITIONS,
		HIDDEN_EFFECTS_KEY,
		applyPreset,
		cloneEffectInstance,
		createEffectInstance,
		deletePreset,
		loadPresets,
		normalizePresetName,
		PRESET_NAME_MAX_LENGTH,
		savePreset,
		updatePreset,
		type EffectInstance,
		type Preset,
		type VolumeLink,
	} from '../../effects';
	import type { SpectrumData } from '../../types';
	import { moveItem, resolveMoveTarget } from '../../effects/reorder';
	import EffectItem from './EffectItem.svelte';

	export type { SpectrumData };

	interface Props {
		effects: EffectInstance[];
		hasTrack?: boolean;
		spectrumData?: SpectrumData | null;
		onVolumeLinkChange?: (
			index: number,
			paramKey: string,
			link: VolumeLink | null,
		) => void;
		/** Called after `effects` is replaced wholesale (e.g. preset load), so callers can push undo history. */
		onEffectsReplaced?: () => void;
		/** Called after a preset is explicitly overwritten via its save icon. */
		onPresetUpdated?: (preset: Preset) => void;
		/** Called after a preset is loaded from the list, with that preset. */
		onPresetApplied?: (preset: Preset) => void;
		/** Called on every user action that changes render output (param change,
		 * enable toggle, add/remove/reorder) — not on expand/lock. */
		onUserEdit?: () => void;
		/** Called immediately before any of those changes is applied, while the
		 * pre-edit state is still intact — lets callers capture undo snapshots
		 * for edits that mutate `effects` in place. `coalesceKey` identifies a
		 * continuously-dragged parameter so consecutive ticks of one gesture can
		 * be merged into a single undo entry; discrete edits pass nothing. */
		onBeforeUserEdit?: (coalesceKey?: string) => void;
	}

	let {
		effects = $bindable(),
		hasTrack = false,
		spectrumData = null,
		onVolumeLinkChange,
		onEffectsReplaced,
		onPresetUpdated,
		onPresetApplied,
		onUserEdit,
		onBeforeUserEdit,
	}: Props = $props();

	let presets: Preset[] = $state(loadPresets());
	// Open when there's something to show — otherwise the starter presets are
	// invisible behind a collapsed header on first run.
	// svelte-ignore state_referenced_locally
	let showPresets = $state(presets.length > 0);
	let saving = $state(false);
	let presetName = $state('');

	// Warn only near the cap, so the row stays quiet for ordinary short names.
	const NAME_COUNTER_FROM = PRESET_NAME_MAX_LENGTH - 8;
	let showNameCounter = $derived(presetName.length >= NAME_COUNTER_FROM);

	function handleSavePreset() {
		// maxlength stops typing, but not a paste on every browser/IME path.
		const name = normalizePresetName(presetName);
		if (!name) return;
		presets = savePreset(name, $state.snapshot(effects));
		presetName = '';
		saving = false;
	}

	// Loading is a one-shot apply — presets are only ever written via the
	// explicit save icons, never automatically.
	function handleLoadPreset(index: number) {
		onBeforeUserEdit?.();
		const applied = applyPreset(presets[index]);
		// Keep the rest of the library in the list, switched off. Replacing the
		// chain outright made every other effect look deleted (they silently fell
		// into "Hidden Effects"), which reads as data loss on what is meant to be
		// a one-click starting point.
		const inPreset = new Set(applied.map((e) => e.defId));
		const rest = effects
			.filter((e) => !inPreset.has(e.defId))
			.map((e) => ({
				...cloneEffectInstance($state.snapshot(e) as EffectInstance),
				enabled: false,
				expanded: false,
			}));
		effects = [...applied, ...rest];
		onEffectsReplaced?.();
		onPresetApplied?.($state.snapshot(presets[index]) as Preset);
	}

	function handleUpdatePreset(index: number) {
		presets = updatePreset(index, $state.snapshot(effects));
		onPresetUpdated?.($state.snapshot(presets[index]) as Preset);
	}

	function handleDeletePreset(index: number) {
		presets = deletePreset(index);
	}

	let dragFromIndex: number | null = $state(null);
	let dragOverIndex: number | null = $state(null);
	let dropPosition: 'above' | 'below' | null = $state(null);

	function toggle(index: number) {
		onBeforeUserEdit?.();
		effects[index].enabled = !effects[index].enabled;
		onUserEdit?.();
	}

	function toggleExpand(index: number) {
		effects[index].expanded = !effects[index].expanded;
	}

	// Hidden effects are tracked as an explicit set of ids the user chose to
	// hide, *not* as "every definition missing from the current chain". The
	// panel's chain is often a subset of the library — a preset-filled sequence
	// segment, say — and deriving the set from it would silently mark the whole
	// rest of the library as permanently hidden.
	function loadHiddenEffectIds(): Set<string> {
		try {
			const raw = localStorage.getItem(HIDDEN_EFFECTS_KEY);
			if (raw) return new Set<string>(JSON.parse(raw));
		} catch {}
		return new Set<string>();
	}

	let hiddenIds = $state<Set<string>>(loadHiddenEffectIds());

	function persistHiddenIds() {
		localStorage.setItem(HIDDEN_EFFECTS_KEY, JSON.stringify([...hiddenIds]));
	}

	// Params of hidden effects, so re-adding one restores it as it was rather
	// than resetting it to defaults.
	const stashedValues = new Map<
		string,
		{
			values: EffectInstance['values'];
			volumeLinks: EffectInstance['volumeLinks'];
		}
	>();

	/**
	 * Hide an effect from the list. This is a persisted preference rather than a
	 * chain edit, so it deliberately stays out of the undo stack — Ctrl+Z can't
	 * un-hide, but one click under "Hidden Effects" restores it with its params.
	 */
	function hide(index: number) {
		const effect = effects[index];
		stashedValues.set(effect.defId, {
			values: $state.snapshot(effect.values) as EffectInstance['values'],
			volumeLinks: $state.snapshot(
				effect.volumeLinks,
			) as EffectInstance['volumeLinks'],
		});
		hiddenIds = new Set([...hiddenIds, effect.defId]);
		persistHiddenIds();
		effects.splice(index, 1);
		// Reveal where it went the first time someone hides an effect
		showHidden = true;
	}

	let hiddenDefs = $derived(
		EFFECT_DEFINITIONS.filter(
			(def) => !effects.some((e) => e.defId === def.id),
		),
	);

	let showHidden = $state(false);

	let searchQuery = $state('');

	let filteredEffects = $derived(
		searchQuery
			? effects
					.map((e, i) => ({ effect: e, index: i }))
					.filter(({ effect }) => {
						const def = EFFECT_DEFINITIONS.find((d) => d.id === effect.defId);
						return def?.name.toLowerCase().includes(searchQuery.toLowerCase());
					})
			: effects.map((e, i) => ({ effect: e, index: i })),
	);

	let filteredHiddenDefs = $derived(
		searchQuery
			? hiddenDefs.filter((def) =>
					def.name.toLowerCase().includes(searchQuery.toLowerCase()),
				)
			: hiddenDefs,
	);

	function addEffect(defId: string) {
		const def = EFFECT_DEFINITIONS.find((d) => d.id === defId);
		if (!def) return;
		if (hiddenIds.has(defId)) {
			hiddenIds = new Set([...hiddenIds].filter((id) => id !== defId));
			persistHiddenIds();
		}
		onBeforeUserEdit?.();
		const instance = createEffectInstance(def);
		const stashed = stashedValues.get(defId);
		if (stashed) {
			instance.values = { ...instance.values, ...stashed.values };
			if (stashed.volumeLinks) instance.volumeLinks = { ...stashed.volumeLinks };
			stashedValues.delete(defId);
		}
		effects.push(instance);
		onUserEdit?.();
	}

	function paramChange(index: number, key: string, value: number | string) {
		onBeforeUserEdit?.(`param:${effects[index].instanceId}:${key}`);
		effects[index].values[key] = value;
		if (!effects[index].enabled) effects[index].enabled = true;
		onUserEdit?.();
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

		onBeforeUserEdit?.();
		const [moved] = effects.splice(dragFromIndex, 1);
		effects.splice(targetIndex, 0, moved);
		clearDragState();
		onUserEdit?.();
	}

	/**
	 * Move an effect by button rather than by drag. `pos` indexes the *visible*
	 * list, and neighbours are taken from it too: with a search active the
	 * adjacent row on screen is rarely adjacent in `effects`, and stepping
	 * through the raw array would look like the button did nothing.
	 */
	async function moveEffect(pos: number, direction: -1 | 1, toEnd: boolean) {
		const visible = filteredEffects;
		const to = resolveMoveTarget(
			visible.map((v) => ({ index: v.index, enabled: v.effect.enabled })),
			pos,
			direction,
			toEnd,
		);
		if (to === null) return;
		const moved = visible[pos].effect;

		onBeforeUserEdit?.();
		moveItem(effects, visible[pos].index, to);
		onUserEdit?.();

		// Keep the effect the user is working on under their eye — after a jump
		// to either end it would otherwise be somewhere off-screen.
		await tick();
		centerOnEffect(moved.instanceId);
	}

	function centerOnEffect(instanceId: string) {
		if (!scrollEl) return;
		const el = scrollEl.querySelector<HTMLElement>(
			`[data-effect-id="${instanceId}"]`,
		);
		if (!el) return;
		const item = el.getBoundingClientRect();
		const container = scrollEl.getBoundingClientRect();
		// Offset from the container's own scrollTop, so this works regardless of
		// where the list sits on the page or which element is the offsetParent.
		const delta =
			item.top - container.top - (container.height - item.height) / 2;
		scrollEl.scrollTo({
			top: scrollEl.scrollTop + delta,
			behavior: 'smooth',
		});
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

	// Touch drag support
	let touchDragFromIndex: number | null = $state(null);
	let scrollEl: HTMLElement | null = null;
	let scrollRafId: number | null = null;

	function stopAutoScroll() {
		if (scrollRafId !== null) {
			cancelAnimationFrame(scrollRafId);
			scrollRafId = null;
		}
	}

	function startAutoScroll(touchY: number) {
		stopAutoScroll();
		if (!scrollEl) return;
		const rect = scrollEl.getBoundingClientRect();
		const zone = 60;
		const maxSpeed = 8;

		function step() {
			if (!scrollEl || touchDragFromIndex === null) return;
			const distTop = touchY - rect.top;
			const distBottom = rect.bottom - touchY;
			if (distTop < zone && distTop > 0) {
				scrollEl.scrollTop -= maxSpeed * (1 - distTop / zone);
			} else if (distBottom < zone && distBottom > 0) {
				scrollEl.scrollTop += maxSpeed * (1 - distBottom / zone);
			} else {
				return;
			}
			scrollRafId = requestAnimationFrame(step);
		}

		scrollRafId = requestAnimationFrame(step);
	}

	function onDocTouchMove(e: TouchEvent) {
		if (touchDragFromIndex === null) return;
		e.preventDefault();
		const touch = e.touches[0];
		startAutoScroll(touch.clientY);
		const el = document.elementFromPoint(touch.clientX, touch.clientY);
		if (!el) return;
		const itemEl = el.closest?.('[data-effect-index]') as HTMLElement | null;
		if (!itemEl) {
			dragOverIndex = null;
			dropPosition = null;
			return;
		}
		const idx = Number(itemEl.dataset.effectIndex);
		if (isNaN(idx) || idx === touchDragFromIndex) {
			dragOverIndex = null;
			dropPosition = null;
			return;
		}
		const rect = itemEl.getBoundingClientRect();
		const midY = rect.top + rect.height / 2;
		dragOverIndex = idx;
		dropPosition = touch.clientY < midY ? 'above' : 'below';
	}

	function onDocTouchEnd() {
		if (touchDragFromIndex === null) return;
		stopAutoScroll();
		if (dragOverIndex !== null) handleDrop(dragOverIndex);
		touchDragFromIndex = null;
		clearDragState();
		document.removeEventListener('touchmove', onDocTouchMove);
		document.removeEventListener('touchend', onDocTouchEnd);
		document.removeEventListener('touchcancel', onDocTouchEnd);
	}

	function handleTouchDragStart(index: number, e: TouchEvent) {
		e.preventDefault();
		touchDragFromIndex = index;
		dragFromIndex = index;
		document.addEventListener('touchmove', onDocTouchMove, { passive: false });
		document.addEventListener('touchend', onDocTouchEnd);
		document.addEventListener('touchcancel', onDocTouchEnd);
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
							maxlength={PRESET_NAME_MAX_LENGTH}
							bind:value={presetName}
							autofocus
						/>
						{#if showNameCounter}
							<span
								class="preset-name-count"
								class:at-max={presetName.length >= PRESET_NAME_MAX_LENGTH}
							>
								{presetName.length}/{PRESET_NAME_MAX_LENGTH}
							</span>
						{/if}
						<button class="preset-confirm-btn" type="submit" title="Save" aria-label="Save preset">
							<Check size={14} />
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
							<X size={14} />
						</button>
					</form>
				{:else}
					<button class="preset-save-trigger" onclick={() => (saving = true)}>
						<Plus size={12} />
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
							class="preset-delete-btn preset-update-btn"
							onclick={() => handleUpdatePreset(i)}
							title="Overwrite with current effects"
						>
							<Save size={11} />
						</button>
						<button
							class="preset-delete-btn"
							onclick={() => handleDeletePreset(i)}
							title="Delete preset"
						>
							<X size={12} />
						</button>
					</div>
				{/each}

				{#if presets.length === 0 && !saving}
					<div class="preset-empty">No saved presets</div>
				{/if}
			</div>
		{/if}
	</div>

	<div class="search-bar">
		<Search class="search-icon" size={13} />
		<input
			class="search-input"
			type="text"
			placeholder="Search effects..."
			bind:value={searchQuery}
		/>
		{#if searchQuery}
			<button
				class="search-clear"
				onclick={() => (searchQuery = '')}
				title="Clear"
			>
				<X size={12} />
			</button>
		{/if}
	</div>

	<div class="panel-scroll" bind:this={scrollEl}>
		{#each filteredEffects as { effect, index: i }, pos (effect.instanceId)}
			<EffectItem
				{effect}
				canMoveUp={pos > 0}
				canMoveDown={pos < filteredEffects.length - 1}
				onMove={(direction, toEnd) => moveEffect(pos, direction, toEnd)}
				{hasTrack}
				{spectrumData}
				onVolumeLinkChange={onVolumeLinkChange
					? (key, link) => onVolumeLinkChange(i, key, link)
					: undefined}
				onToggle={() => toggle(i)}
				onToggleExpand={() => toggleExpand(i)}
				onHide={() => hide(i)}
				onParamChange={(key, value) => paramChange(i, key, value)}
				isDragging={dragFromIndex === i}
				dropIndicator={getDropIndicator(i)}
				onDragStart={(e) => handleDragStart(i, e)}
				onDragOver={(e) => handleDragOver(i, e)}
				onDragLeave={() => handleDragLeave(i)}
				onDrop={() => handleDrop(i)}
				onDragEnd={clearDragState}
				onTouchDragStart={(e) => handleTouchDragStart(i, e)}
				effectIndex={i}
			/>
		{/each}

		{#if filteredHiddenDefs.length > 0}
			<button class="hidden-header" onclick={() => (showHidden = !showHidden)}>
				<span class="hidden-arrow" class:expanded={showHidden || !!searchQuery}
					>&#9654;</span
				>
				<span>Hidden Effects ({filteredHiddenDefs.length})</span>
			</button>

			{#if showHidden || searchQuery}
				<div class="hidden-list">
					{#each filteredHiddenDefs as def (def.id)}
						<div class="hidden-item">
							<span class="hidden-name">{def.name}</span>
							<button
								class="add-btn"
								onclick={() => addEffect(def.id)}
								title="Add to chain"
							>
								<Plus size={14} />
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
		flex: 1;
		min-height: 0;
		width: 310px;
		max-width: 310px;
		background: #161616;
		display: flex;
		flex-direction: column;
		flex-shrink: 0;
	}

	@media (max-width: 800px) {
		.effects-panel {
			max-width: 100%;
			width: 100%;
		}
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
		align-items: center;
		gap: 0.25rem;
	}

	.preset-name-count {
		flex-shrink: 0;
		font-size: 0.6rem;
		color: #666;
		font-variant-numeric: tabular-nums;
	}

	.preset-name-count.at-max {
		color: #c07a7a;
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

	.preset-update-btn:hover {
		color: #8b8;
		background: rgba(80, 200, 80, 0.08);
	}

	.preset-empty {
		font-size: 0.68rem;
		color: #444;
		padding: 0.2rem 0.5rem;
	}

	.search-bar {
		display: flex;
		align-items: center;
		gap: 0.4rem;
		padding: 0.45rem 0.6rem;
		border-bottom: 1px solid #222;
		flex-shrink: 0;
	}

	.search-bar :global(.search-icon) {
		color: #555;
		flex-shrink: 0;
	}

	.search-input {
		flex: 1;
		min-width: 0;
		padding: 0.25rem 0.3rem;
		background: none;
		border: none;
		color: #ccc;
		font-size: 0.75rem;
		font-family: inherit;
		outline: none;
	}

	.search-input::placeholder {
		color: #444;
	}

	.search-clear {
		display: flex;
		align-items: center;
		justify-content: center;
		width: 18px;
		height: 18px;
		background: none;
		border: none;
		color: #555;
		cursor: pointer;
		padding: 0;
		border-radius: 3px;
		flex-shrink: 0;
		transition: color 0.15s;
	}

	.search-clear:hover {
		color: #999;
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
		transition:
			color 0.15s,
			background 0.15s;
	}

	.add-btn:hover {
		color: #aaa;
		background: rgba(255, 255, 255, 0.05);
	}
</style>
