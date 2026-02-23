<script lang="ts">
	import EffectItem from './EffectItem.svelte';
	import {
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

	function toggleLock(index: number) {
		effects[index].locked = !effects[index].locked;
	}

	function toggleExpand(index: number) {
		effects[index].expanded = !effects[index].expanded;
	}

	function reset(index: number) {
		const def = getDefinition(effects[index].defId);
		if (!def) return;
		effects[index].values = Object.fromEntries(
			def.params.map((p) => [p.key, p.defaultValue]),
		);
		effects[index].enabled = false;
	}

	function duplicate(index: number) {
		const source = effects[index];
		const def = getDefinition(source.defId);
		if (!def) return;
		const copy = createEffectInstance(def);
		copy.enabled = source.enabled;
		copy.values = { ...source.values };
		effects.splice(index + 1, 0, copy);
	}

	function remove(index: number) {
		const remaining = effects.filter((e) => e.defId === effects[index].defId);
		if (remaining.length > 1) {
			effects.splice(index, 1);
		} else {
			reset(index);
		}
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
				onToggleLock={() => toggleLock(i)}
				onToggleExpand={() => toggleExpand(i)}
				onReset={() => reset(i)}
				onDuplicate={() => duplicate(i)}
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
</style>
