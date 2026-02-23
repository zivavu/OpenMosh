<script lang="ts">
	import EffectItem from './EffectItem.svelte';
	import {
		EFFECT_DEFINITIONS,
		createEffectInstance,
		type EffectInstance,
		getDefinition,
	} from './effects';

	interface Props {
		effects: EffectInstance[];
	}

	let { effects = $bindable() }: Props = $props();

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
	<div class="panel-scroll">
		{#each effects as effect, i (effect.instanceId)}
			<EffectItem
				{effect}
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
