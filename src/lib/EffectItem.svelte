<script lang="ts">
	import {
		getDefinition,
		type EffectInstance,
		type VolumeLink,
	} from './effects';

	interface Props {
		effect: EffectInstance;
		hasTrack?: boolean;
		onVolumeLinkChange?: (paramKey: string, link: VolumeLink | null) => void;
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
		hasTrack = false,
		onVolumeLinkChange,
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
		ondragend={() => {
			canDrag = false;
			onDragEnd();
		}}
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
							<div class="param-range-wrap">
								<input
									id="{effect.instanceId}-{param.key}"
									type="range"
									min={param.min}
									max={param.max}
									step={param.step}
									value={effect.values[param.key]}
									disabled={!!effect.volumeLinks?.[param.key]}
									oninput={(e) =>
										onParamChange(param.key, parseFloat(e.currentTarget.value))}
								/>
								<span class="param-value"
									>{parseFloat(effect.values[param.key].toString()).toFixed(
										2,
									)}</span
								>
								{#if hasTrack && onVolumeLinkChange}
									{#if effect.volumeLinks?.[param.key]}
										{@const link = effect.volumeLinks[param.key]}
										<div class="volume-link-row">
											<span class="volume-link-label">Vol →</span>
											<input
												type="number"
												class="volume-link-input"
												min={param.min}
												max={param.max}
												step={param.step}
												value={link.min}
												oninput={(e) => {
													const v = parseFloat(e.currentTarget.value);
													if (!Number.isNaN(v))
														onVolumeLinkChange(param.key, { ...link, min: v });
												}}
											/>
											<span class="volume-link-sep">–</span>
											<input
												type="number"
												class="volume-link-input"
												min={param.min}
												max={param.max}
												step={param.step}
												value={link.max}
												oninput={(e) => {
													const v = parseFloat(e.currentTarget.value);
													if (!Number.isNaN(v))
														onVolumeLinkChange(param.key, { ...link, max: v });
												}}
											/>
											<button
												type="button"
												class="volume-unlink-btn"
												title="Unlink from volume"
												onclick={() => onVolumeLinkChange(param.key, null)}
											>
												<svg
													width="12"
													height="12"
													viewBox="0 0 24 24"
													fill="none"
													stroke="currentColor"
													stroke-width="2"
												>
													<line x1="18" y1="6" x2="6" y2="18" />
													<line x1="6" y1="6" x2="18" y2="18" />
												</svg>
											</button>
										</div>
									{:else}
										<button
											type="button"
											class="volume-link-btn"
											title="Link to music volume (slider will follow volume in a range)"
											onclick={() =>
												onVolumeLinkChange(param.key, {
													min: param.min,
													max: param.max,
												})}
										>
											<svg
												width="12"
												height="12"
												viewBox="0 0 24 24"
												fill="none"
												stroke="currentColor"
												stroke-width="2"
											>
												<path d="M9 18V5l12-2v13" />
												<circle cx="6" cy="18" r="3" />
												<circle cx="18" cy="16" r="3" />
											</svg>
											Link
										</button>
									{/if}
								{/if}
							</div>
						{/if}
						{#if param.type === 'checkbox'}
							<input
								id="{effect.instanceId}-{param.key}"
								type="checkbox"
								checked={effect.values[param.key] === 1}
								onchange={(e) =>
									onParamChange(param.key, e.currentTarget.checked ? 1 : 0)}
							/>
						{/if}
						{#if param.type === 'select'}
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
		flex-wrap: wrap;
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

	.param-range-wrap {
		flex: 1;
		min-width: 0;
		display: flex;
		align-items: center;
		gap: 0.4rem;
		flex-wrap: wrap;
	}

	.param-range-wrap input[type='range'] {
		flex: 1;
		min-width: 80px;
	}

	.volume-link-btn {
		display: inline-flex;
		align-items: center;
		gap: 0.25rem;
		padding: 0.2rem 0.4rem;
		font-size: 0.65rem;
		font-family: inherit;
		color: #666;
		background: #2a2a2a;
		border: 1px solid #333;
		border-radius: 4px;
		cursor: pointer;
		transition:
			color 0.15s,
			border-color 0.15s;
		flex-shrink: 0;
	}

	.volume-link-btn:hover {
		color: #999;
		border-color: #555;
	}

	.volume-link-row {
		display: flex;
		align-items: center;
		gap: 0.25rem;
		width: 100%;
		margin-top: 0.25rem;
		padding-left: 0;
	}

	.volume-link-label {
		font-size: 0.65rem;
		color: #555;
		flex-shrink: 0;
	}

	.volume-link-input {
		width: 3.5rem;
		padding: 0.15rem 0.3rem;
		font-size: 0.65rem;
		font-family: inherit;
		background: #222;
		border: 1px solid #333;
		border-radius: 4px;
		color: #bbb;
	}

	.volume-link-sep {
		font-size: 0.65rem;
		color: #555;
	}

	.volume-unlink-btn {
		display: flex;
		align-items: center;
		justify-content: center;
		padding: 0.2rem;
		background: none;
		border: 1px solid #333;
		border-radius: 4px;
		color: #666;
		cursor: pointer;
		transition:
			color 0.15s,
			border-color 0.15s;
	}

	.volume-unlink-btn:hover {
		color: #999;
		border-color: #555;
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

	input[type='checkbox'] {
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

	input[type='checkbox']:hover {
		border-color: #777;
	}

	input[type='checkbox']:checked {
		background: #555;
		border-color: #888;
	}

	input[type='checkbox']:checked::after {
		content: '';
		position: absolute;
		inset: 0;
		display: flex;
		align-items: center;
		justify-content: center;
		width: 100%;
		height: 100%;
		background: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 12 12'%3E%3Cpath d='M2.5 6l2.5 2.5 4.5-5' stroke='%23ddd' stroke-width='1.8' fill='none' stroke-linecap='round' stroke-linejoin='round'/%3E%3C/svg%3E")
			center/contain no-repeat;
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
