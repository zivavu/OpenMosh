<script lang="ts">
	import { tick } from "svelte";
	import { SvelteSet } from "svelte/reactivity";
	import { readJson, writeJson } from "../../storage";
	import {
		Check,
		ChevronDown,
		ChevronsDownUp,
		Filter,
		Plus,
		Save,
		Search,
		X,
	} from "lucide-svelte";
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
	} from "../../effects";
	import type { SpectrumData } from "../../types";
	import type { AudioResponse } from "../../audio/auto-range";
	import { moveItem, resolveMoveTarget } from "../../effects/reorder";
	import { isMoshable } from "../../editor/mosh";
	import EffectItem from "./EffectItem.svelte";

	export type { SpectrumData };

	interface Props {
		effects: EffectInstance[];
		/** No "Signal chain" head; the live count moves into the search row. */
		headless?: boolean;
		hasTrack?: boolean;
		spectrumData?: SpectrumData | null;
		/** Passed to the spectrum read-out on each volume link. */
		response?: AudioResponse;
		onVolumeLinkChange?: (
			index: number,
			paramKey: string,
			link: VolumeLink | null,
		) => void;
		/** Called after `effects` is replaced wholesale, so callers can push undo history. */
		onEffectsReplaced?: () => void;
		onPresetUpdated?: (preset: Preset) => void;
		onPresetApplied?: (preset: Preset) => void;
		/** Called on every user action that changes render output, not on expand/lock. */
		onUserEdit?: () => void;
		/** Called before a change is applied, while the pre-edit state is intact.
		 * `coalesceKey` merges consecutive ticks of one drag into one undo entry. */
		onBeforeUserEdit?: (coalesceKey?: string) => void;
		/** Set when `effects` is not a chain the user can edit; the rack shows this instead. */
		noTarget?: { title: string; hint: string } | null;
		/** Set when something else decides which effects are on, e.g. the slideshow's
		 * random and smooth modes. The switches stand down. */
		rolledNote?: string | null;
		/** Set when the roll owns the whole chain: an auto clip rebuilds the list every tick. */
		rolledChain?: boolean;
		/** Which effects the roll owns: 'all' rebuilds the chain, 'moshable' runs over a copy. */
		rolledScope?: "all" | "moshable";
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
		rolledScope = "all",
		headless = false,
	}: Props = $props();

	/** False for an effect the roll leaves alone; its controls stay live. */
	function isRolled(effect: EffectInstance): boolean {
		return rolledScope === "all" || isMoshable(effect);
	}

	let liveCount = $derived(effects.filter((e) => e.enabled).length);

	let presets: Preset[] = $state(loadPresets());
	let saving = $state(false);
	let presetName = $state("");
	/** The preset the chain was last set from, lit until the chain is edited. */
	let appliedIndex = $state<number | null>(null);

	/** The picker is a disclosure: one line closed, a full-width list open. */
	let presetsOpen = $state(false);

	let activePresetName = $derived(
		appliedIndex === null ? null : (presets[appliedIndex]?.name ?? null),
	);

	// Warn only near the cap, so the row stays quiet for ordinary short names.
	const NAME_COUNTER_FROM = PRESET_NAME_MAX_LENGTH - 8;
	let showNameCounter = $derived(presetName.length >= NAME_COUNTER_FROM);

	function handleSavePreset() {
		// maxlength stops typing, but not a paste on every browser/IME path.
		const name = normalizePresetName(presetName);
		if (!name) return;
		presets = savePreset(name, $state.snapshot(effects));
		presetName = "";
		saving = false;
	}

	// Loading is a one-shot apply; presets are only written via the explicit save icons.
	function handleLoadPreset(index: number) {
		onBeforeUserEdit?.();
		const applied = applyPreset(presets[index]);
		// Keep the rest of the library in the list, switched off: replacing the chain
		// outright made other effects look deleted.
		const inPreset = new Set(applied.map((e) => e.defId));
		const rest = effects
			.filter((e) => !inPreset.has(e.defId))
			.map((e) => ({
				...cloneEffectInstance($state.snapshot(e) as EffectInstance),
				enabled: false,
				expanded: false,
			}));
		effects = [...applied, ...rest];
		appliedIndex = index;
		onEffectsReplaced?.();
		onPresetApplied?.($state.snapshot(presets[index]) as Preset);
	}

	function handleUpdatePreset(index: number) {
		presets = updatePreset(index, $state.snapshot(effects));
		appliedIndex = index;
		onPresetUpdated?.($state.snapshot(presets[index]) as Preset);
	}

	function handleDeletePreset(index: number) {
		presets = deletePreset(index);
		if (appliedIndex === index) appliedIndex = null;
		else if (appliedIndex !== null && appliedIndex > index) appliedIndex--;
	}

	let dragFromIndex: number | null = $state(null);
	let dragOverIndex: number | null = $state(null);
	let dropPosition: "above" | "below" | null = $state(null);

	function toggle(index: number) {
		onBeforeUserEdit?.();
		effects[index].enabled = !effects[index].enabled;
		if (onlyLive && !effects[index].enabled)
			livePinned.add(effects[index].instanceId);
		appliedIndex = null;
		onUserEdit?.();
	}

	function toggleExpand(index: number) {
		effects[index].expanded = !effects[index].expanded;
	}

	// Expansion is view state, not a chain edit, so it stays out of undo.
	const anyExpanded = $derived(!rolledChain && effects.some((e) => e.expanded));

	function collapseAll() {
		for (const effect of effects) effect.expanded = false;
	}

	// Hidden effects are an explicit set of ids the user chose to hide, not every
	// definition missing from the chain.
	function loadHiddenEffectIds(): Set<string> {
		return new Set(readJson<string[]>(HIDDEN_EFFECTS_KEY, []));
	}

	let hiddenIds = $state<Set<string>>(loadHiddenEffectIds());

	function persistHiddenIds() {
		writeJson(HIDDEN_EFFECTS_KEY, [...hiddenIds]);
	}

	// Params of hidden effects, so re-adding one restores it as it was.
	const stashedValues = new Map<
		string,
		{
			values: EffectInstance["values"];
			volumeLinks: EffectInstance["volumeLinks"];
		}
	>();

	function isCopy(effect: EffectInstance): boolean {
		return effects.filter((e) => e.defId === effect.defId).length > 1;
	}

	function duplicate(index: number) {
		onBeforeUserEdit?.();
		const copy = cloneEffectInstance(
			$state.snapshot(effects[index]) as EffectInstance,
		);
		copy.expanded = true;
		effects.splice(index + 1, 0, copy);
		appliedIndex = null;
		onUserEdit?.();
	}

	/** Hide an effect from the list. A persisted preference, so it stays out of undo. */
	function hide(index: number) {
		const effect = effects[index];
		if (isCopy(effect)) {
			onBeforeUserEdit?.();
			effects.splice(index, 1);
			appliedIndex = null;
			onUserEdit?.();
			return;
		}
		stashedValues.set(effect.defId, {
			values: $state.snapshot(effect.values) as EffectInstance["values"],
			volumeLinks: $state.snapshot(
				effect.volumeLinks,
			) as EffectInstance["volumeLinks"],
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

	let searchQuery = $state("");

	// Narrows the list to the effects actually passing signal.
	let onlyLive = $state(false);
	// Effects the live filter keeps around once switched off: the set live when it came on.
	let livePinned = new SvelteSet<string>();

	function setOnlyLive(on: boolean) {
		livePinned.clear();
		if (on)
			for (const e of effects) if (e.enabled) livePinned.add(e.instanceId);
		onlyLive = on;
	}

	let filteredEffects = $derived(
		effects
			.map((e, i) => ({ effect: e, index: i }))
			.filter(({ effect }) => {
				if (onlyLive && !effect.enabled && !livePinned.has(effect.instanceId))
					return false;
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
			if (stashed.volumeLinks)
				instance.volumeLinks = { ...stashed.volumeLinks };
			stashedValues.delete(defId);
		}
		effects.push(instance);
		appliedIndex = null;
		onUserEdit?.();
	}

	function paramChange(index: number, key: string, value: number | string) {
		onBeforeUserEdit?.(`param:${effects[index].instanceId}:${key}`);
		effects[index].values[key] = value;
		if (!effects[index].enabled) effects[index].enabled = true;
		appliedIndex = null;
		onUserEdit?.();
	}

	function handleDragStart(index: number, e: DragEvent) {
		dragFromIndex = index;
		if (e.dataTransfer) {
			e.dataTransfer.effectAllowed = "move";
			e.dataTransfer.setData("text/plain", String(index));
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
		dropPosition = e.clientY < midY ? "above" : "below";
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
		if (dropPosition === "below") targetIndex += 1;
		if (dragFromIndex < targetIndex) targetIndex -= 1;

		onBeforeUserEdit?.();
		const [moved] = effects.splice(dragFromIndex, 1);
		effects.splice(targetIndex, 0, moved);
		clearDragState();
		appliedIndex = null;
		onUserEdit?.();
	}

	/** Move an effect by button. `pos` indexes the visible list, not `effects`. */
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
		appliedIndex = null;
		onUserEdit?.();

		// Keep the effect under the user's eye; after a jump to either end it would be
		// off-screen.
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
		// Offset from the container's own scrollTop, so this works regardless of offsetParent.
		const delta =
			item.top - container.top - (container.height - item.height) / 2;
		box.scrollTo({
			top: box.scrollTop + delta,
			behavior: "smooth",
		});
	}

	function clearDragState() {
		dragFromIndex = null;
		dragOverIndex = null;
		dropPosition = null;
	}

	function getDropIndicator(index: number): "above" | "below" | null {
		if (dragOverIndex !== index) return null;
		return dropPosition;
	}

	let touchDragFromIndex: number | null = $state(null);
	// $state because the rack stands down (and the binding drops to null) with no chain.
	let listEl = $state<HTMLElement | null>(null);
	let scrollRafId: number | null = null;

	/** The scroll box this chain lives in. Walked rather than passed in: which
	 * ancestor scrolls is not the caller's. */
	function scrollBox(): HTMLElement | null {
		for (let el = listEl?.parentElement; el; el = el.parentElement) {
			const overflow = getComputedStyle(el).overflowY;
			if (overflow === "auto" || overflow === "scroll") return el;
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
		const itemEl = el.closest?.("[data-effect-index]") as HTMLElement | null;
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
		dropPosition = touch.clientY < midY ? "above" : "below";
	}

	function onDocTouchEnd() {
		if (touchDragFromIndex === null) return;
		stopAutoScroll();
		if (dragOverIndex !== null) handleDrop(dragOverIndex);
		touchDragFromIndex = null;
		clearDragState();
		document.removeEventListener("touchmove", onDocTouchMove);
		document.removeEventListener("touchend", onDocTouchEnd);
		document.removeEventListener("touchcancel", onDocTouchEnd);
	}

	function handleTouchDragStart(index: number, e: TouchEvent) {
		e.preventDefault();
		touchDragFromIndex = index;
		dragFromIndex = index;
		document.addEventListener("touchmove", onDocTouchMove, { passive: false });
		document.addEventListener("touchend", onDocTouchEnd);
		document.addEventListener("touchcancel", onDocTouchEnd);
	}
</script>

<aside class="effects-panel">
	<!-- Head, presets and search stay put while the chain scrolls under them. -->
	<div class="panel-tools">
		{#if !headless}
			<header class="panel-head">
				<span class="rack-label">Signal chain</span>
				{#if !noTarget}
					<span class="chain-count readout" class:live={liveCount > 0}>
						{liveCount} live
					</span>
				{/if}
			</header>
		{/if}

		{#if !noTarget}
			<div class="presets-row">
				<div class="presets-head">
					<span class="rack-label">Presets</span>
					<div class="presets-tools">
						<button
							class="preset-tool"
							onclick={() => (saving = true)}
							title="Save the current chain as a preset"
							aria-label="Save preset"
						>
							<Plus size={12} />
						</button>
					</div>
				</div>

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
							placeholder="Name this chain"
							maxlength={PRESET_NAME_MAX_LENGTH}
							bind:value={presetName}
							onkeydown={(e) => {
								if (e.key === "Escape") {
									saving = false;
									presetName = "";
								}
							}}
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
						<button
							class="preset-tool"
							type="submit"
							title="Save"
							aria-label="Save preset"
						>
							<Check size={13} />
						</button>
						<button
							class="preset-tool"
							type="button"
							onclick={() => {
								saving = false;
								presetName = "";
							}}
							title="Cancel"
						>
							<X size={13} />
						</button>
					</form>
				{:else if presets.length === 0}
					<div class="preset-empty">
						<span>No presets yet</span>
						<button class="preset-empty-action" onclick={() => (saving = true)}>
							Save this chain
						</button>
					</div>
				{:else}
					<button
						class="preset-trigger"
						class:loaded={activePresetName !== null}
						onclick={() => (presetsOpen = !presetsOpen)}
						aria-expanded={presetsOpen}
						title={presetsOpen ? "Hide presets" : "Show presets"}
					>
						<span class="preset-trigger-name">
							{activePresetName ?? "Choose a preset"}
						</span>
						<span class="preset-trigger-count readout">{presets.length}</span>
						<span class="preset-trigger-chevron">
							<ChevronDown size={13} />
						</span>
					</button>

					{#if presetsOpen}
						<ul class="preset-list">
							{#each presets as preset, index (index)}
								<li class="preset-row" class:active={appliedIndex === index}>
									<button
										class="preset-row-load"
										onclick={() => handleLoadPreset(index)}
										title={`Load ${preset.name}`}
										aria-pressed={appliedIndex === index}
									>
										<span class="preset-row-index readout">
											{String(index + 1).padStart(2, "0")}
										</span>
										<span class="preset-row-name">{preset.name}</span>
										<span class="preset-row-count readout">
											{preset.effects.filter((e) => e.enabled).length} fx
										</span>
									</button>
									<button
										class="preset-mini"
										onclick={() => handleUpdatePreset(index)}
										title="Overwrite with the current chain"
										aria-label="Overwrite preset"
									>
										<Save size={10} />
									</button>
									<button
										class="preset-mini preset-mini--rec"
										onclick={() => handleDeletePreset(index)}
										title="Delete preset"
										aria-label="Delete preset"
									>
										<X size={10} />
									</button>
								</li>
							{/each}
						</ul>
					{/if}
				{/if}
			</div>

			<div class="search-bar">
				<Search class="search-icon" size={13} />
				<input
					class="search-input"
					type="text"
					placeholder="Search effects"
					bind:value={searchQuery}
				/>
				{#if searchQuery}
					<button
						class="search-clear"
						onclick={() => (searchQuery = "")}
						title="Clear"
					>
						<X size={12} />
					</button>
				{/if}
				{#if headless}
					<span class="chain-count readout" class:live={liveCount > 0}>
						{liveCount} live
					</span>
				{/if}
				<button
					class="search-clear live-filter"
					class:on={onlyLive}
					onclick={() => setOnlyLive(!onlyLive)}
					title={onlyLive
						? "Showing live effects only — click to show the whole chain"
						: "Show live effects only"}
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
		{/if}
	</div>

	{#if noTarget}
		<div class="panel-list">
			<div class="list-empty">
				<p class="empty-title">{noTarget.title}</p>
				<p class="empty-hint">{noTarget.hint}</p>
			</div>
		</div>
	{:else}
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
						<button class="empty-action" onclick={() => setOnlyLive(false)}>
							Show the whole chain
						</button>
					{:else if onlyLive}
						<p class="empty-title">Nothing is live</p>
						<p class="empty-hint">
							Switch an effect on, or hit MOSH to fill the chain for you.
						</p>
						<button class="empty-action" onclick={() => setOnlyLive(false)}>
							Show the whole chain
						</button>
					{:else if searchQuery}
						<p class="empty-title">No match</p>
						<p class="empty-hint">Nothing here is called “{searchQuery}”.</p>
						<button class="empty-action" onclick={() => (searchQuery = "")}>
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
				<button
					class="hidden-header"
					onclick={() => (showHidden = !showHidden)}
				>
					<span
						class="hidden-arrow"
						class:expanded={showHidden || !!searchQuery}>&#9654;</span
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
		/* Natural height, never its own scrollbox: the sidebar around it scrolls as one
		   region. */
		flex: 0 0 auto;
		width: 100%;
		max-width: var(--sidebar-w);
		background: var(--surface);
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

	/* Pinned to whatever scrolls around the panel, so the tools are always in reach. */
	.panel-tools {
		position: sticky;
		top: 0;
		z-index: 2;
		background: var(--surface);
		flex-shrink: 0;
	}

	/* Stacking context, so slider thumbs and drop lines can't ride over the tools. */
	.panel-list {
		isolation: isolate;
	}

	.panel-head {
		display: flex;
		align-items: center;
		justify-content: space-between;
		padding: 0.55rem 0.75rem;
		border-bottom: 1px solid var(--line);
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

	.presets-row {
		display: flex;
		flex-direction: column;
		gap: 0.4rem;
		padding: 0.5rem 0.6rem 0.55rem;
		border-bottom: 1px solid var(--line);
	}

	.presets-head {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: 0.35rem;
	}

	.presets-tools {
		display: flex;
		align-items: center;
		gap: 0.15rem;
	}

	.preset-trigger {
		display: flex;
		align-items: center;
		gap: 0.4rem;
		width: 100%;
		height: 28px;
		padding: 0 0.5rem 0 0.6rem;
		background: var(--sunken);
		border: 1px solid var(--line);
		border-radius: var(--r-2);
		color: var(--text-3);
		font-family: inherit;
		font-size: 0.72rem;
		text-align: left;
		cursor: pointer;
		transition:
			color var(--t-fast),
			border-color var(--t-fast),
			background var(--t-fast);
	}

	.preset-trigger:hover {
		color: var(--text-2);
		border-color: var(--line-strong);
	}

	/* A chain that came from a preset says so. */
	.preset-trigger.loaded {
		color: var(--mosh);
		border-color: var(--mosh-dim);
		background: color-mix(in srgb, var(--mosh) 8%, var(--sunken));
	}

	.preset-trigger-name {
		flex: 1;
		min-width: 0;
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}

	.preset-trigger-count {
		flex-shrink: 0;
		font-size: 0.6rem;
		color: var(--text-4);
	}

	.preset-trigger-chevron {
		display: flex;
		flex-shrink: 0;
		color: var(--text-4);
		transition: transform var(--t-fast);
	}

	.preset-trigger[aria-expanded="true"] .preset-trigger-chevron {
		transform: rotate(180deg);
	}

	.preset-list {
		display: flex;
		flex-direction: column;
		margin: 0;
		padding: 0;
		list-style: none;
		background: var(--sunken);
		border: 1px solid var(--line);
		border-radius: var(--r-2);
		overflow: hidden;
	}

	.preset-row {
		display: flex;
		align-items: center;
		border-top: 1px solid var(--line);
	}

	.preset-row:first-child {
		border-top: none;
	}

	.preset-row-load {
		display: flex;
		align-items: center;
		gap: 0.5rem;
		flex: 1;
		min-width: 0;
		height: 28px;
		padding: 0 0.6rem;
		background: none;
		border: none;
		color: var(--text-2);
		font-family: inherit;
		font-size: 0.72rem;
		text-align: left;
		cursor: pointer;
		transition:
			color var(--t-fast),
			background var(--t-fast);
	}

	.preset-row-load:hover {
		color: var(--text);
		background: rgba(255, 255, 255, 0.04);
	}

	/* The chain is this preset, untouched. */
	.preset-row.active .preset-row-load {
		color: var(--mosh);
		background: color-mix(in srgb, var(--mosh) 10%, transparent);
	}

	/* The list clips its own corners, so the ring has to draw inside them. */
	.preset-row-load:focus-visible {
		outline-offset: -2px;
	}

	.preset-row-index {
		flex-shrink: 0;
		font-size: 0.6rem;
		color: var(--text-4);
	}

	.preset-row.active .preset-row-index {
		color: var(--mosh-dim);
	}

	.preset-row-name {
		flex: 1;
		min-width: 0;
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}

	.preset-row-count {
		flex-shrink: 0;
		font-size: 0.6rem;
		color: var(--text-4);
	}

	.preset-mini {
		display: flex;
		align-items: center;
		justify-content: center;
		width: 20px;
		height: 100%;
		background: none;
		border: none;
		border-left: 1px solid var(--line);
		color: var(--text-4);
		cursor: pointer;
		padding: 0;
		transition:
			color var(--t-fast),
			background var(--t-fast);
	}

	.preset-mini:hover {
		color: var(--live);
		background: rgba(110, 231, 192, 0.1);
	}

	.preset-mini--rec:hover {
		color: var(--rec);
		background: rgba(255, 95, 86, 0.1);
	}

	.preset-tool {
		display: flex;
		align-items: center;
		justify-content: center;
		flex-shrink: 0;
		width: 22px;
		height: 22px;
		background: none;
		border: none;
		border-radius: var(--r-1);
		color: var(--text-4);
		cursor: pointer;
		padding: 0;
		transition:
			color var(--t-fast),
			background var(--t-fast);
	}

	.preset-tool:hover {
		color: var(--text);
		background: rgba(255, 255, 255, 0.06);
	}

	/* The save row is the trigger's box, with the field sitting inside it. */
	.preset-save-row {
		display: flex;
		align-items: center;
		gap: 0.15rem;
		width: 100%;
		height: 28px;
		padding: 0 0.25rem 0 0.6rem;
		background: var(--sunken);
		border: 1px solid var(--mosh-dim);
		border-radius: var(--r-2);
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
		height: 100%;
		padding: 0;
		background: none;
		border: none;
		color: var(--text);
		font-family: inherit;
		font-size: 0.72rem;
		outline: none;
	}

	.preset-name-input::placeholder {
		color: var(--text-4);
	}

	.preset-empty {
		display: flex;
		align-items: center;
		gap: 0.5rem;
		font-size: 0.68rem;
		color: var(--text-4);
	}

	.preset-empty-action {
		background: none;
		border: none;
		padding: 0;
		color: var(--mosh);
		font: inherit;
		cursor: pointer;
		text-decoration: underline;
		text-underline-offset: 2px;
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

	.hidden-header:hover {
		color: var(--mosh);
	}

	.hidden-arrow {
		font-size: 0.5rem;
		transition: transform var(--t);
	}

	.hidden-arrow.expanded {
		transform: rotate(90deg);
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

	/* Standing in for the list, so a filtered-to-nothing panel still says what happened. */
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
