<script lang="ts">
	import { tick } from 'svelte';
	import { readJson, writeJson } from '../../storage';
	import {
		Check,
		ChevronsDownUp,
		Filter,
		Plus,
		Save,
		Search,
		X,
	} from 'lucide-svelte';
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
	import type { AudioResponse } from '../../audio/auto-range';
	import { moveItem, resolveMoveTarget } from '../../effects/reorder';
	import { isMoshable } from '../../editor/mosh';
	import EffectItem from './EffectItem.svelte';

	export type { SpectrumData };

	interface Props {
		effects: EffectInstance[];
		hasTrack?: boolean;
		spectrumData?: SpectrumData | null;
		/** Passed to the spectrum read-out on each volume link. */
		response?: AudioResponse;
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
		/** Set when `effects` is not a chain the user can edit — sequence mode
		 * with nothing selected renders the segment under the playhead, and any
		 * edit there is thrown away on the next re-roll. The rack stands down and
		 * shows this instead of pretending to be that chain. */
		noTarget?: { title: string; hint: string } | null;
		/** Set when something else decides which effects are on — the slideshow's
		 * random and smooth modes roll the chain every beat. The switches stand
		 * down; everything else, hiding especially, still works, since hiding is
		 * how an effect is kept out of the roll. */
		rolledNote?: string | null;
		/** Set when the roll owns the whole chain, not just its switches — a
		 * sequence auto segment rebuilds the list from scratch every tick, so a
		 * hand reorder or param tweak there is thrown away. Drops the reorder
		 * affordances and the param drawers; hiding still works. */
		rolledChain?: boolean;
		/** Which effects the roll actually owns. 'all' — the chain is rebuilt from
		 * scratch, so nothing in it survives. 'moshable' — the roll runs over a
		 * copy and skips non-moshable effects, so those keep the user's switch,
		 * order and params and stay fully editable. */
		rolledScope?: 'all' | 'moshable';
	}

	let {
		effects = $bindable(),
		hasTrack = false,
		spectrumData = null,
		response = undefined,
		onVolumeLinkChange,
		onEffectsReplaced,
		onPresetUpdated,
		onPresetApplied,
		onUserEdit,
		onBeforeUserEdit,
		noTarget = null,
		rolledNote = null,
		rolledChain = false,
		rolledScope = 'all',
	}: Props = $props();

	/** False for an effect the roll leaves alone — its controls stay live. */
	function isRolled(effect: EffectInstance): boolean {
		return rolledScope === 'all' || isMoshable(effect);
	}

	/** How many effects are actually passing signal, shown in the panel header. */
	let liveCount = $derived(effects.filter((e) => e.enabled).length);

	let presets: Preset[] = $state(loadPresets());
	// Collapsed: the count in the header says they're there, and the effect
	// chain below is what the panel is for.
	let showPresets = $state(false);
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
		// into "Hidden effects"), which reads as data loss on what is meant to be
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

	// Expansion is view state, not a chain edit — deliberately out of undo.
	const anyExpanded = $derived(!rolledChain && effects.some((e) => e.expanded));

	function collapseAll() {
		for (const effect of effects) effect.expanded = false;
	}

	// Hidden effects are tracked as an explicit set of ids the user chose to
	// hide, *not* as "every definition missing from the current chain". The
	// panel's chain is often a subset of the library — a preset-filled sequence
	// segment, say — and deriving the set from it would silently mark the whole
	// rest of the library as permanently hidden.
	function loadHiddenEffectIds(): Set<string> {
		return new Set(readJson<string[]>(HIDDEN_EFFECTS_KEY, []));
	}

	let hiddenIds = $state<Set<string>>(loadHiddenEffectIds());

	function persistHiddenIds() {
		writeJson(HIDDEN_EFFECTS_KEY, [...hiddenIds]);
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

	/** True when the chain holds more than one instance of this effect. */
	function isCopy(effect: EffectInstance): boolean {
		return effects.filter((e) => e.defId === effect.defId).length > 1;
	}

	/** Insert an independent copy of an effect right below it. */
	function duplicate(index: number) {
		onBeforeUserEdit?.();
		const copy = cloneEffectInstance(
			$state.snapshot(effects[index]) as EffectInstance,
		);
		copy.expanded = true;
		effects.splice(index + 1, 0, copy);
		onUserEdit?.();
	}

	/**
	 * Hide an effect from the list. This is a persisted preference rather than a
	 * chain edit, so it deliberately stays out of the undo stack — Ctrl+Z can't
	 * un-hide, but one click under "Hidden effects" restores it with its params.
	 *
	 * Copies are the exception: with other instances left in the chain there is
	 * nothing to hide, so this is an ordinary (undoable) delete.
	 */
	function hide(index: number) {
		const effect = effects[index];
		if (isCopy(effect)) {
			onBeforeUserEdit?.();
			effects.splice(index, 1);
			onUserEdit?.();
			return;
		}
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

	// Narrows the list to the effects actually passing signal — the working set
	// once a mosh has filled the chain with things you don't want to scroll past.
	let onlyLive = $state(false);

	let filteredEffects = $derived(
		effects
			.map((e, i) => ({ effect: e, index: i }))
			.filter(({ effect }) => {
				if (onlyLive && !effect.enabled) return false;
				if (!searchQuery) return true;
				const def = EFFECT_DEFINITIONS.find((d) => d.id === effect.defId);
				return def?.name.toLowerCase().includes(searchQuery.toLowerCase());
			}),
	);

	// Nothing in here is live, so the section has no place in a live-only list.
	let filteredHiddenDefs = $derived(
		onlyLive
			? []
			: searchQuery
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
		const box = scrollBox();
		const el = listEl?.querySelector<HTMLElement>(
			`[data-effect-id="${instanceId}"]`,
		);
		if (!box || !el) return;
		const item = el.getBoundingClientRect();
		const container = box.getBoundingClientRect();
		// Offset from the container's own scrollTop, so this works regardless of
		// where the list sits on the page or which element is the offsetParent.
		const delta =
			item.top - container.top - (container.height - item.height) / 2;
		box.scrollTo({
			top: box.scrollTop + delta,
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
	// $state because the rack stands down (and the binding drops to null) when
	// there is no chain to edit.
	let listEl = $state<HTMLElement | null>(null);
	let scrollRafId: number | null = null;

	/**
	 * The scroll box this chain lives in — the sidebar column, or the mobile
	 * sheet's tab. The chain does not scroll on its own, so the one thing that
	 * can carry an effect into view is whatever scrolls around it.
	 *
	 * Walked rather than passed in: the panel sits directly in the sidebar in
	 * one place and nested inside a clip panel in another, and which ancestor
	 * scrolls is not something either caller should have to state.
	 */
	function scrollBox(): HTMLElement | null {
		for (let el = listEl?.parentElement; el; el = el.parentElement) {
			const overflow = getComputedStyle(el).overflowY;
			if (overflow === 'auto' || overflow === 'scroll') return el;
		}
		return null;
	}

	function stopAutoScroll() {
		if (scrollRafId !== null) {
			cancelAnimationFrame(scrollRafId);
			scrollRafId = null;
		}
	}

	function startAutoScroll(touchY: number) {
		stopAutoScroll();
		const box = scrollBox();
		if (!box) return;
		const rect = box.getBoundingClientRect();
		const zone = 60;
		const maxSpeed = 8;

		function step() {
			if (touchDragFromIndex === null) return;
			const distTop = touchY - rect.top;
			const distBottom = rect.bottom - touchY;
			if (distTop < zone && distTop > 0) {
				box!.scrollTop -= maxSpeed * (1 - distTop / zone);
			} else if (distBottom < zone && distBottom > 0) {
				box!.scrollTop += maxSpeed * (1 - distBottom / zone);
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
	<header class="panel-head">
		<span class="rack-label">Signal chain</span>
		{#if !noTarget}
			<span class="chain-count readout" class:live={liveCount > 0}>
				{liveCount} live
			</span>
		{/if}
	</header>

	{#if noTarget}
		<div class="panel-list">
			<div class="list-empty">
				<p class="empty-title">{noTarget.title}</p>
				<p class="empty-hint">{noTarget.hint}</p>
			</div>
		</div>
	{:else}
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
		<button
			class="search-clear live-filter"
			class:on={onlyLive}
			onclick={() => (onlyLive = !onlyLive)}
			title={onlyLive
				? 'Showing live effects only — click to show the whole chain'
				: 'Show live effects only'}
			aria-pressed={onlyLive}
			aria-label="Show live effects only"
		>
			<Filter size={13} />
		</button>
		{#if anyExpanded}
			<button
				class="search-clear"
				onclick={collapseAll}
				title="Collapse all open effects"
				aria-label="Collapse all effects"
			>
				<ChevronsDownUp size={13} />
			</button>
		{/if}
	</div>

	<div class="panel-list" bind:this={listEl}>
		{#if rolledNote}
			<p class="rolled-note">{rolledNote}</p>
		{/if}
		{#each filteredEffects as { effect, index: i }, pos (effect.instanceId)}
			<EffectItem
				{effect}
				canMoveUp={pos > 0}
				canMoveDown={pos < filteredEffects.length - 1}
				onMove={(direction, toEnd) => moveEffect(pos, direction, toEnd)}
				{hasTrack}
				{spectrumData}
				{response}
				onVolumeLinkChange={onVolumeLinkChange
					? (key, link) => onVolumeLinkChange(i, key, link)
					: undefined}
				onToggle={() => toggle(i)}
				rolledNote={isRolled(effect) ? rolledNote : null}
				rolledChain={rolledChain && isRolled(effect)}
				onToggleExpand={() => toggleExpand(i)}
				onHide={() => hide(i)}
				onDuplicate={() => duplicate(i)}
				isCopy={isCopy(effect)}
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

		{#if filteredEffects.length === 0}
			<div class="list-empty">
				{#if onlyLive && searchQuery}
					<p class="empty-title">No live match</p>
					<p class="empty-hint">
						Nothing switched on is called “{searchQuery}”.
					</p>
					<button class="empty-action" onclick={() => (onlyLive = false)}>
						Show the whole chain
					</button>
				{:else if onlyLive}
					<p class="empty-title">Nothing is live</p>
					<p class="empty-hint">
						Switch an effect on, or hit MOSH to fill the chain for you.
					</p>
					<button class="empty-action" onclick={() => (onlyLive = false)}>
						Show the whole chain
					</button>
				{:else if searchQuery}
					<p class="empty-title">No match</p>
					<p class="empty-hint">Nothing here is called “{searchQuery}”.</p>
					<button class="empty-action" onclick={() => (searchQuery = '')}>
						Clear the search
					</button>
				{:else}
					<p class="empty-title">The chain is empty</p>
					<p class="empty-hint">
						Add effects from the list below to start building a look.
					</p>
				{/if}
			</div>
		{/if}

		{#if filteredHiddenDefs.length > 0}
			<button class="hidden-header" onclick={() => (showHidden = !showHidden)}>
				<span class="hidden-arrow" class:expanded={showHidden || !!searchQuery}
					>&#9654;</span
				>
				<span>Hidden effects ({filteredHiddenDefs.length})</span>
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
	{/if}
</aside>

<style>
	.effects-panel {
		/* Natural height, never its own scrollbox: the sidebar around it scrolls
		   as one region, and a chain that scrolled inside that would be a
		   second scroller nested in the first. */
		flex: 0 0 auto;
		width: 100%;
		max-width: var(--sidebar-w);
		background: var(--surface);
		border-left: 1px solid var(--line);
		display: flex;
		flex-direction: column;
		flex-shrink: 0;
	}

	@media (max-width: 800px) {
		.effects-panel {
			max-width: 100%;
			width: 100%;
			border-left: none;
		}
	}

	.panel-head {
		display: flex;
		align-items: center;
		justify-content: space-between;
		padding: 0.55rem 0.75rem;
		border-bottom: 1px solid var(--line);
		flex-shrink: 0;
	}

	.chain-count {
		display: inline-flex;
		align-items: center;
		gap: 0.35rem;
		font-size: 0.6rem;
		letter-spacing: 0.1em;
		text-transform: uppercase;
		color: var(--text-4);
		transition: color var(--t);
	}

	.chain-count.live {
		color: var(--live);
	}

	.presets-section {
		border-bottom: 1px solid var(--line);
		flex-shrink: 0;
	}

	.presets-header,
	.hidden-header {
		display: flex;
		align-items: center;
		gap: 0.5rem;
		width: 100%;
		padding: 0.5rem 0.75rem;
		background: none;
		border: none;
		color: var(--text-3);
		font-family: var(--font-mono);
		font-size: 0.62rem;
		font-weight: 600;
		letter-spacing: 0.14em;
		text-transform: uppercase;
		cursor: pointer;
		transition: color var(--t-fast);
	}

	.rolled-note {
		margin: 0 0 0.4rem;
		padding: 0.35rem 0.5rem;
		border-left: 2px solid var(--mosh-dim);
		background: var(--sunken);
		color: var(--text-3);
		font-size: 0.65rem;
		line-height: 1.35;
	}

	.presets-header:hover,
	.hidden-header:hover {
		color: var(--mosh);
	}

	.presets-arrow,
	.hidden-arrow {
		font-size: 0.5rem;
		transition: transform var(--t);
	}

	.presets-arrow.expanded,
	.hidden-arrow.expanded {
		transform: rotate(90deg);
	}

	.presets-body {
		padding: 0 0.6rem 0.55rem;
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
		border: 1px dashed var(--line-strong);
		border-radius: var(--r-2);
		color: var(--text-3);
		font-family: var(--font-mono);
		font-size: 0.62rem;
		letter-spacing: 0.08em;
		text-transform: uppercase;
		cursor: pointer;
		transition:
			color var(--t-fast),
			border-color var(--t-fast);
	}

	.preset-save-trigger:hover {
		color: var(--mosh);
		border-color: var(--mosh-dim);
	}

	.preset-save-row {
		display: flex;
		align-items: center;
		gap: 0.25rem;
	}

	.preset-name-count {
		flex-shrink: 0;
		font-family: var(--font-mono);
		font-size: 0.58rem;
		color: var(--text-3);
		font-variant-numeric: tabular-nums;
	}

	.preset-name-count.at-max {
		color: var(--rec);
	}

	.preset-name-input {
		flex: 1;
		min-width: 0;
		padding: 0.3rem 0.5rem;
		background: var(--sunken);
		border: 1px solid var(--line);
		border-radius: var(--r-2);
		color: var(--text);
		font-size: 0.72rem;
		font-family: inherit;
		outline: none;
	}

	.preset-name-input:focus {
		border-color: var(--mosh-dim);
	}

	.preset-confirm-btn,
	.preset-cancel-btn {
		display: flex;
		align-items: center;
		justify-content: center;
		width: 26px;
		height: 26px;
		background: none;
		border: 1px solid var(--line);
		border-radius: var(--r-2);
		color: var(--text-3);
		cursor: pointer;
		padding: 0;
		transition:
			color var(--t-fast),
			border-color var(--t-fast);
	}

	.preset-confirm-btn:hover {
		color: var(--live);
		border-color: var(--live-dim);
	}

	.preset-cancel-btn:hover {
		color: var(--rec);
		border-color: var(--rec-dim);
	}

	.preset-item {
		display: flex;
		align-items: center;
		gap: 0.25rem;
	}

	.preset-load-btn {
		flex: 1;
		padding: 0.35rem 0.55rem;
		background: rgba(198, 162, 234, 0.05);
		border: 1px solid var(--line);
		border-radius: var(--r-2);
		color: var(--text-2);
		font-size: 0.72rem;
		font-family: inherit;
		text-align: left;
		cursor: pointer;
		white-space: nowrap;
		overflow: hidden;
		text-overflow: ellipsis;
		transition:
			color var(--t-fast),
			border-color var(--t-fast),
			background var(--t-fast);
	}

	.preset-load-btn:hover {
		color: var(--mosh);
		border-color: var(--mosh-dim);
		background: rgba(198, 162, 234, 0.1);
	}

	.preset-delete-btn {
		display: flex;
		align-items: center;
		justify-content: center;
		width: 22px;
		height: 22px;
		background: none;
		border: none;
		color: var(--text-4);
		cursor: pointer;
		border-radius: var(--r-1);
		padding: 0;
		flex-shrink: 0;
		transition:
			color var(--t-fast),
			background var(--t-fast);
	}

	.preset-delete-btn:hover {
		color: var(--rec);
		background: rgba(255, 95, 86, 0.1);
	}

	.preset-update-btn:hover {
		color: var(--live);
		background: rgba(110, 231, 192, 0.1);
	}

	.preset-empty {
		font-size: 0.68rem;
		color: var(--text-4);
		padding: 0.2rem 0.5rem;
	}

	.search-bar {
		display: flex;
		align-items: center;
		gap: 0.4rem;
		padding: 0.4rem 0.7rem;
		border-bottom: 1px solid var(--line);
		flex-shrink: 0;
	}

	.search-bar :global(.search-icon) {
		color: var(--text-4);
		flex-shrink: 0;
	}

	.search-input {
		flex: 1;
		min-width: 0;
		padding: 0.25rem 0.3rem;
		background: none;
		border: none;
		color: var(--text);
		font-size: 0.75rem;
		font-family: inherit;
		outline: none;
	}

	.search-input::placeholder {
		color: var(--text-4);
	}

	.search-clear {
		display: flex;
		align-items: center;
		justify-content: center;
		width: 18px;
		height: 18px;
		background: none;
		border: none;
		color: var(--text-4);
		cursor: pointer;
		padding: 0;
		border-radius: var(--r-1);
		flex-shrink: 0;
		transition: color var(--t-fast);
	}

	.search-clear:hover {
		color: var(--text);
	}

	.live-filter.on {
		color: var(--live);
	}

	/* Standing in for the list, so a filtered-to-nothing panel still says what
	   happened and offers the way out. */
	.list-empty {
		display: flex;
		flex-direction: column;
		align-items: center;
		gap: 0.4rem;
		padding: 2.25rem 1.5rem;
		text-align: center;
	}

	.empty-title {
		font-family: var(--font-mono);
		font-size: 0.62rem;
		font-weight: 600;
		letter-spacing: 0.14em;
		text-transform: uppercase;
		color: var(--text-2);
	}

	.empty-hint {
		font-size: 0.72rem;
		line-height: 1.5;
		color: var(--text-3);
		max-width: 24ch;
	}

	.empty-action {
		margin-top: 0.35rem;
		padding: 0.3rem 0.8rem;
		border: 1px solid var(--line-strong);
		border-radius: var(--r-pill);
		background: none;
		color: var(--text-2);
		font-family: var(--font-mono);
		font-size: 0.6rem;
		letter-spacing: 0.1em;
		text-transform: uppercase;
		cursor: pointer;
		transition:
			color var(--t-fast),
			border-color var(--t-fast),
			background var(--t-fast);
	}

	.empty-action:hover {
		color: var(--live);
		border-color: var(--live-dim);
		background: rgba(110, 231, 192, 0.1);
	}

	.hidden-header {
		border-top: 1px solid var(--line);
	}

	.hidden-list {
		border-top: 1px solid var(--line);
	}

	.hidden-item {
		display: flex;
		align-items: center;
		/* Aligned to the effect strips above, past the 30px signal rail. */
		padding: 0.3rem 0.6rem 0.3rem calc(30px + 0.6rem);
		border-bottom: 1px solid rgba(255, 255, 255, 0.04);
	}

	.hidden-item:hover {
		background: rgba(255, 255, 255, 0.02);
	}

	.hidden-name {
		flex: 1;
		font-size: 0.75rem;
		color: var(--text-3);
	}

	.add-btn {
		display: flex;
		align-items: center;
		justify-content: center;
		width: 22px;
		height: 22px;
		background: none;
		border: none;
		color: var(--text-4);
		cursor: pointer;
		border-radius: var(--r-1);
		padding: 0;
		transition:
			color var(--t-fast),
			background var(--t-fast);
	}

	.add-btn:hover {
		color: var(--live);
		background: rgba(110, 231, 192, 0.1);
	}
</style>
