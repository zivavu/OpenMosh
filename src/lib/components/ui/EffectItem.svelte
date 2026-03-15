<script lang="ts">
	import { X, GripVertical, ArrowUpDown, Music } from 'lucide-svelte';
	import DualRangeSlider from './DualRangeSlider.svelte';
	import RangeSlider from './RangeSlider.svelte';
	import SpectrumDisplay from './SpectrumDisplay.svelte';
	import {
		FREQ_PRESETS,
		getDefinition,
		type EffectInstance,
		type VolumeLink,
	} from '../../effects';
	import type { SpectrumData } from '../../types';

	export type { SpectrumData };

	/** Piecewise-linear mapping: 75% of slider (0–750) = 20–8000 Hz, 25% (750–1000) = 8000–20000 Hz */
	function sliderToFreq(s: number): number {
		if (s <= 750) return 20 + (s / 750) * (8000 - 20);
		return 8000 + ((s - 750) / 250) * (20000 - 8000);
	}

	function freqToSlider(hz: number): number {
		if (hz <= 8000) return ((hz - 20) / (8000 - 20)) * 750;
		return 750 + ((hz - 8000) / (20000 - 8000)) * 250;
	}

	interface Props {
		effect: EffectInstance;
		hasTrack?: boolean;
		spectrumData?: SpectrumData | null;
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
		spectrumData = null,
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
	// UI state for frequency settings expansion for each param.key
	let expandedFreqSettings = $state<Record<string, boolean>>({});

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
					<X size={14} />
				</button>

				<span
					class="drag-handle"
					title="Drag to reorder"
					onmousedown={() => (canDrag = true)}
					onmouseup={() => (canDrag = false)}
				>
					<GripVertical size={14} />
				</span>
			</div>
		</div>

		{#if effect.expanded}
			<div class="params">
				{#each def.params.filter((p) => !p.visibleWhen || p.visibleWhen(effect.values)) as param}
					<div class="param-row">
						<label class="param-label" for="{effect.instanceId}-{param.key}"
							>{param.label}</label
						>
						{#if param.type === 'range'}
							<div class="param-range-wrap">
								<RangeSlider
									id="{effect.instanceId}-{param.key}"
									value={effect.values[param.key]}
									min={param.min}
									max={param.max}
									step={param.step}
									disabled={!!effect.volumeLinks?.[param.key]}
									oninput={(v) => onParamChange(param.key, v)}
									ondblclick={() => onParamChange(param.key, param.defaultValue)}
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
											<div class="volume-link-slider">
												<DualRangeSlider
													min={param.min}
													max={param.max}
													step={param.step}
													valueLow={link.min}
													valueHigh={link.max}
													onChangeLow={(v) =>
														onVolumeLinkChange(param.key, { ...link, min: v })}
													onChangeHigh={(v) =>
														onVolumeLinkChange(param.key, { ...link, max: v })}
													formatValue={(v) =>
														parseFloat(v.toString()).toFixed(2)}
												/>
											</div>
											<button
												type="button"
												class="volume-invert-btn"
												class:active={link.inverted}
												title={link.inverted
													? 'Inverted: low volume = high effect'
													: 'Normal: high volume = high effect'}
												onclick={() =>
													onVolumeLinkChange(param.key, {
														...link,
														inverted: !link.inverted,
													})}
											>
												<ArrowUpDown size={12} />
											</button>
											<button
												type="button"
												class="volume-unlink-btn"
												title="Unlink from volume"
												onclick={() => onVolumeLinkChange(param.key, null)}
											>
												<X size={12} />
											</button>
										</div>
										<div class="volume-freq-row">
											<span class="volume-link-label">Freq</span>
											<div class="freq-presets">
												<button
													type="button"
													class="freq-preset-btn"
													class:active={link.freqMin == null &&
														link.freqMax == null}
													title="Full spectrum"
													onclick={() =>
														onVolumeLinkChange(param.key, {
															...link,
															freqMin: undefined,
															freqMax: undefined,
														})}>Full</button
												>
												<button
													type="button"
													class="freq-preset-btn"
													class:active={link.freqMin === FREQ_PRESETS.low.min &&
														link.freqMax === FREQ_PRESETS.low.max}
													title="Low (20–250 Hz)"
													onclick={() =>
														onVolumeLinkChange(param.key, {
															...link,
															freqMin: FREQ_PRESETS.low.min,
															freqMax: FREQ_PRESETS.low.max,
														})}>Low</button
												>
												<button
													type="button"
													class="freq-preset-btn"
													class:active={link.freqMin === FREQ_PRESETS.mid.min &&
														link.freqMax === FREQ_PRESETS.mid.max}
													title="Mid (250–4000 Hz)"
													onclick={() =>
														onVolumeLinkChange(param.key, {
															...link,
															freqMin: FREQ_PRESETS.mid.min,
															freqMax: FREQ_PRESETS.mid.max,
														})}>Mid</button
												>
												<button
													type="button"
													class="freq-preset-btn"
													class:active={link.freqMin ===
														FREQ_PRESETS.high.min &&
														link.freqMax === FREQ_PRESETS.high.max}
													title="High (4k–20k Hz)"
													onclick={() =>
														onVolumeLinkChange(param.key, {
															...link,
															freqMin: FREQ_PRESETS.high.min,
															freqMax: FREQ_PRESETS.high.max,
														})}>High</button
												>
											</div>
										</div>
										{#if link.freqMin != null && link.freqMax != null && spectrumData}
											<div class="spectrum-wrap">
												<SpectrumDisplay
													data={spectrumData.data}
													sampleRate={spectrumData.sampleRate}
													binCount={spectrumData.binCount}
													freqMin={link.freqMin ?? 0}
													freqMax={link.freqMax ?? 20000}
													width={200}
													height={48}
													tick={spectrumData.tick}
												/>
												<div class="spectrum-inputs">
													<span class="spectrum-label">Freq</span>
													<div class="spectrum-slider">
														<DualRangeSlider
															min={0}
															max={1000}
															step={1}
															valueLow={freqToSlider(link.freqMin ?? 20)}
															valueHigh={freqToSlider(link.freqMax ?? 20000)}
															onChangeLow={(v) =>
																onVolumeLinkChange(param.key, {
																	...link,
																	freqMin: sliderToFreq(v),
																})}
															onChangeHigh={(v) =>
																onVolumeLinkChange(param.key, {
																	...link,
																	freqMax: sliderToFreq(v),
																})}
															formatValue={(v) =>
																`${Math.round(sliderToFreq(v))} Hz`}
														/>
													</div>
												</div>
											</div>
										{/if}
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
											<Music size={12} />
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
		gap: 0;
	}

	.param-row {
		display: flex;
		gap: 0.5rem;
		flex-wrap: wrap;
		padding: 0.35rem 0;
	}

	.param-row + .param-row {
		border-top: 1px solid #2a2a2a;
		margin-top: 0.15rem;
		padding-top: 0.5rem;
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
		gap: 0.4rem;
		width: 100%;
		margin-top: 0.25rem;
		padding-left: 0;
	}

	.volume-link-label {
		font-size: 0.65rem;
		color: #555;
		flex-shrink: 0;
	}

	.volume-link-slider {
		flex: 1;
		min-width: 0;
	}

	.volume-invert-btn {
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
			border-color 0.15s,
			background 0.15s;
	}

	.volume-invert-btn:hover {
		color: #999;
		border-color: #555;
	}

	.volume-invert-btn.active {
		color: #aac;
		border-color: #558;
		background: rgba(100, 140, 200, 0.15);
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

	.volume-freq-row {
		display: flex;
		align-items: center;
		gap: 0.35rem;
		width: 100%;
		margin-top: 0.2rem;
		flex-wrap: wrap;
	}

	.freq-presets {
		display: flex;
		flex-wrap: wrap;
		gap: 0.2rem;
	}

	.freq-preset-btn {
		padding: 0.15rem 0.4rem;
		font-size: 0.6rem;
		font-family: inherit;
		color: #666;
		background: #2a2a2a;
		border: 1px solid #333;
		border-radius: 3px;
		cursor: pointer;
		transition:
			color 0.15s,
			border-color 0.15s,
			background 0.15s;
	}

	.freq-preset-btn:hover {
		color: #999;
		border-color: #555;
	}

	.freq-preset-btn.active {
		color: #aac;
		border-color: #558;
		background: rgba(100, 140, 200, 0.15);
	}

	.spectrum-wrap {
		width: 100%;
		margin-top: 0.35rem;
		display: flex;
		flex-direction: column;
		gap: 0.25rem;
	}

	.spectrum-wrap :global(.spectrum-canvas) {
		width: 100%;
		max-width: 200px;
		height: 48px;
	}

	.spectrum-inputs {
		display: flex;
		align-items: center;
		gap: 0.35rem;
	}

	.spectrum-label {
		font-size: 0.65rem;
		color: #555;
		flex-shrink: 0;
	}

	.spectrum-slider {
		flex: 1;
		min-width: 0;
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
