<script lang="ts">
	import { getDefinition, type EffectInstance } from './effects';

	interface Props {
		effect: EffectInstance;
		onToggle: () => void;
		onToggleExpand: () => void;
		onRemove: () => void;
		onParamChange: (key: string, value: number | string) => void;
		isDragging: boolean;
		dropIndicator: 'above' | 'below' | null;
		onDragStart: (e: DragEvent) => void;
		onDragOver: (e: DragEvent) => void;
		onDragLeave: () => void;
		onDrop: (e: DragEvent) => void;
		onDragEnd: () => void;
	}

	let {
		effect,
		onToggle,
		onToggleExpand,
		onRemove,
		onParamChange,
		isDragging = false,
		dropIndicator = null,
		onDragStart,
		onDragOver,
		onDragLeave,
		onDrop,
		onDragEnd,
	}: Props = $props();

	const def = $derived(getDefinition(effect.defId));

	let canDrag = $state(false);

  function handleDragStart(e: DragEvent) {
    if (!canDrag) {
      e.preventDefault();
      return;
    }
    canDrag = false;
    onDragStart(e);
  }
</script>

{#if def}
	<!-- svelte-ignore a11y_no_static_element_interactions -->
	<div
		class="effect-item"
		class:enabled={effect.enabled}
		class:is-dragging={isDragging}
		class:drop-above={dropIndicator === 'above'}
		class:drop-below={dropIndicator === 'below'}
		draggable={canDrag}
		ondragstart={handleDragStart}
		ondragover={(e) => {
			e.preventDefault();
			onDragOver(e);
		}}
		ondragleave={onDragLeave}
		ondrop={(e) => {
			e.preventDefault();
			onDrop(e);
		}}
		ondragend={() => { canDrag = false; onDragEnd(); }}
	>
		<div class="header" role="group">
			<button class="expand-trigger" onclick={onToggleExpand}>
				<span class="expand-arrow" class:expanded={effect.expanded}
					>&#9654;</span
				>
				<span class="name">{def.name}</span>
			</button>

			<div class="controls">
				<button
					class="toggle"
					class:on={effect.enabled}
					onclick={onToggle}
					title={effect.enabled ? 'Disable' : 'Enable'}
				>
					<span class="toggle-knob"></span>
				</button>

			<button class="icon-btn" onclick={onRemove} title="Remove">
					<svg
						width="14"
						height="14"
						viewBox="0 0 24 24"
						fill="none"
						stroke="currentColor"
						stroke-width="2"
					>
						<line x1="18" y1="6" x2="6" y2="18" />
						<line x1="6" y1="6" x2="18" y2="18" />
					</svg>
				</button>

				<span
					class="drag-handle"
					title="Drag to reorder"
					onmousedown={() => (canDrag = true)}
					onmouseup={() => (canDrag = false)}
				>
					<svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor">
						<circle cx="9" cy="5" r="1.5" />
						<circle cx="15" cy="5" r="1.5" />
						<circle cx="9" cy="12" r="1.5" />
						<circle cx="15" cy="12" r="1.5" />
						<circle cx="9" cy="19" r="1.5" />
						<circle cx="15" cy="19" r="1.5" />
					</svg>
				</span>
			</div>
		</div>

		{#if effect.expanded}
			<div class="params">
				{#each def.params as param}
					<div class="param-row">
						<label class="param-label" for="{effect.instanceId}-{param.key}"
							>{param.label}</label
						>
						{#if param.type === 'range'}
							<input
								id="{effect.instanceId}-{param.key}"
								type="range"
								min={param.min}
								max={param.max}
								step={param.step}
								value={effect.values[param.key]}
								oninput={(e) =>
									onParamChange(param.key, parseFloat(e.currentTarget.value))}
							/>
							<span class="param-value">{effect.values[param.key]}</span>
						{:else if param.type === 'select'}
							<select
								id="{effect.instanceId}-{param.key}"
								value={effect.values[param.key]}
								onchange={(e) =>
									onParamChange(param.key, e.currentTarget.value)}
							>
								{#each param.options as opt}
									<option value={opt.value}>{opt.label}</option>
								{/each}
							</select>
						{/if}
					</div>
				{/each}
			</div>
		{/if}
	</div>
{/if}

<style>
	.effect-item {
		border-bottom: 1px solid #1e1e1e;
		position: relative;
	}

	.effect-item.enabled {
		background: rgba(255, 255, 255, 0.02);
	}

	.effect-item.is-dragging {
		opacity: 0.35;
	}

	.effect-item.drop-above::before,
	.effect-item.drop-below::after {
		content: '';
		position: absolute;
		left: 0;
		right: 0;
		height: 2px;
		background: #666;
		pointer-events: none;
		z-index: 5;
	}

	.effect-item.drop-above::before {
		top: -1px;
	}

	.effect-item.drop-below::after {
		bottom: -1px;
	}

	.header {
		display: flex;
		align-items: center;
		width: 100%;
		padding: 0.5rem 0.6rem;
		gap: 0;
		color: #999;
		font-size: 0.8rem;
		transition: background 0.15s;
	}

	.header:hover {
		background: rgba(255, 255, 255, 0.03);
	}

	.enabled .header {
		color: #ddd;
	}

	.expand-trigger {
		display: flex;
		align-items: center;
		gap: 0.5rem;
		flex: 1;
		min-width: 0;
		background: none;
		border: none;
		color: inherit;
		font-family: inherit;
		font-size: inherit;
		cursor: pointer;
		padding: 0;
	}

	.expand-arrow {
		font-size: 0.55rem;
		transition: transform 0.15s;
		flex-shrink: 0;
		width: 0.8rem;
		text-align: center;
	}

	.expand-arrow.expanded {
		transform: rotate(90deg);
	}

	.name {
		flex: 1;
		text-align: left;
		white-space: nowrap;
		overflow: hidden;
		text-overflow: ellipsis;
		font-weight: 500;
	}

	.controls {
		display: flex;
		align-items: center;
		gap: 0.3rem;
		flex-shrink: 0;
	}

	/* Toggle switch */
	.toggle {
		position: relative;
		width: 28px;
		height: 14px;
		border-radius: 7px;
		background: #333;
		border: none;
		cursor: pointer;
		padding: 0;
		transition: background 0.2s;
	}

	.toggle.on {
		background: #666;
	}

	.toggle-knob {
		position: absolute;
		top: 2px;
		left: 2px;
		width: 10px;
		height: 10px;
		border-radius: 50%;
		background: #888;
		transition:
			transform 0.2s,
			background 0.2s;
	}

	.toggle.on .toggle-knob {
		transform: translateX(14px);
		background: #ccc;
	}

	/* Icon buttons */
	.icon-btn {
		display: flex;
		align-items: center;
		justify-content: center;
		width: 22px;
		height: 22px;
		background: none;
		border: none;
		color: #555;
		cursor: pointer;
		border-radius: 3px;
		padding: 0;
		transition:
			color 0.15s,
			background 0.15s;
	}

	.icon-btn:hover {
		color: #aaa;
		background: rgba(255, 255, 255, 0.05);
	}

	.drag-handle {
		display: flex;
		align-items: center;
		justify-content: center;
		width: 22px;
		height: 22px;
		color: #444;
		cursor: grab;
	}

	.drag-handle:hover {
		color: #888;
	}

	/* Params panel */
	.params {
		padding: 0.4rem 0.8rem 0.6rem 1.8rem;
		display: flex;
		flex-direction: column;
		gap: 0.45rem;
	}

	.param-row {
		display: flex;
		align-items: center;
		gap: 0.5rem;
	}

	.param-label {
		font-size: 0.7rem;
		color: #777;
		min-width: 70px;
		flex-shrink: 0;
	}

	.param-value {
		font-size: 0.7rem;
		color: #888;
		min-width: 36px;
		text-align: right;
		font-variant-numeric: tabular-nums;
	}

	input[type='range'] {
		flex: 1;
		height: 3px;
		appearance: none;
		background: #333;
		border-radius: 2px;
		outline: none;
		cursor: pointer;
	}

	input[type='range']::-webkit-slider-thumb {
		appearance: none;
		width: 10px;
		height: 10px;
		border-radius: 50%;
		background: #aaa;
		cursor: pointer;
		transition: background 0.15s;
	}

	input[type='range']::-webkit-slider-thumb:hover {
		background: #ddd;
	}

	select {
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

	select:focus {
		border-color: #555;
	}

</style>
