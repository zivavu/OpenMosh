<script lang="ts">
	import {
		ArrowUpDown,
		ChevronDown,
		ChevronUp,
		Copy,
		EyeOff,
		GripVertical,
		Music,
		Trash2,
		X,
	} from 'lucide-svelte';
	import {
		FREQ_PRESETS,
		getDefinition,
		type EffectInstance,
		type VolumeLink,
	} from '../../effects';
	import type { SpectrumData } from '../../types';
	import ColorPicker from './ColorPicker.svelte';
	import DualRangeSlider from './DualRangeSlider.svelte';
	import RangeSlider from './RangeSlider.svelte';
	import SpectrumDisplay from './SpectrumDisplay.svelte';
	import {
		DEFAULT_AUDIO_RESPONSE,
		type AudioResponse,
	} from '../../audio/auto-range';

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

	const FREQ_PRESET_BUTTONS = [
		// Full stores no band on the link; it resolves to FREQ_PRESETS.full.
		{ label: 'Full', title: 'Full spectrum (20–16k Hz)', min: undefined, max: undefined },
		{
			label: 'Low',
			title: 'Low (20–500 Hz)',
			min: FREQ_PRESETS.low.min,
			max: FREQ_PRESETS.low.max,
		},
		{
			label: 'Mid',
			title: 'Mid (500–4000 Hz)',
			min: FREQ_PRESETS.mid.min,
			max: FREQ_PRESETS.mid.max,
		},
		{
			label: 'High',
			title: 'High (4k–16k Hz)',
			min: FREQ_PRESETS.high.min,
			max: FREQ_PRESETS.high.max,
		},
	] as const;

	interface Props {
		effect: EffectInstance;
		hasTrack?: boolean;
		spectrumData?: SpectrumData | null;
		/** How this chain follows the music — the spectrum read-out is drawn
		 * through it, so it shows the value the parameter actually rides. */
		response?: AudioResponse;
		onVolumeLinkChange?: (paramKey: string, link: VolumeLink | null) => void;
		onToggle: () => void;
		/** Set when the chain's on/off state is not the user's to set — the
		 * slideshow's rolling modes decide it per beat. The switch still shows
		 * what is passing signal, but says why it can't be moved. */
		rolledNote?: string | null;
		/** Set when the whole list — order and params, not just the switches — is
		 * rebuilt by the roll. Reordering and opening the params would both be
		 * undone by the next tick, so those affordances go away rather than
		 * sitting there dead. */
		rolledChain?: boolean;
		onToggleExpand: () => void;
		/** Hide from the effect list (a persisted preference, not a chain edit). */
		onHide: () => void;
		/** Insert an independent copy right below this one. */
		onDuplicate: () => void;
		/** True when the chain holds other copies of this effect — hiding one copy
		 * would be a chain edit, so it removes instead. */
		isCopy?: boolean;
		/** Step one place in `direction`, or jump to that end when `toEnd`. */
		onMove: (direction: -1 | 1, toEnd: boolean) => void;
		canMoveUp: boolean;
		canMoveDown: boolean;
		onParamChange: (key: string, value: number | string) => void;
		isDragging: boolean;
		dropIndicator: 'above' | 'below' | null;
		onDragStart: (e: DragEvent) => void;
		onDragOver: (e: DragEvent) => void;
		onDragLeave: () => void;
		onDrop: (e: DragEvent) => void;
		onDragEnd: () => void;
		onTouchDragStart?: (e: TouchEvent) => void;
		effectIndex?: number;
	}

	let {
		effect,
		hasTrack = false,
		spectrumData = null,
		response = DEFAULT_AUDIO_RESPONSE,
		onVolumeLinkChange,
		onToggle,
		rolledNote = null,
		rolledChain = false,
		onToggleExpand,
		onHide,
		onDuplicate,
		isCopy = false,
		onMove,
		canMoveUp,
		canMoveDown,
		onParamChange,
		isDragging = false,
		dropIndicator = null,
		onDragStart,
		onDragOver,
		onDragLeave,
		onDrop,
		onDragEnd,
		onTouchDragStart,
		effectIndex,
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
		data-effect-index={effectIndex}
		data-effect-id={effect.instanceId}
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
		<!-- The rail runs the height of every strip, lit where signal passes, so
		     the chain reads as one continuous path down the panel. -->
		<div class="rail" aria-hidden="true">
			<span class="rail-index readout"
				>{String((effectIndex ?? 0) + 1).padStart(2, '0')}</span
			>
		</div>
		<div class="strip">
		<div class="header" role="group">
			{#if rolledChain}
				<span class="expand-trigger static"><span class="name">{def.name}</span></span>
			{:else}
				<button class="expand-trigger" onclick={onToggleExpand}>
					<span class="expand-arrow" class:expanded={effect.expanded}
						>&#9654;</span
					>
					<span class="name">{def.name}</span>
				</button>
			{/if}

			<div class="controls">
				<button
					class="toggle"
					class:on={effect.enabled}
					onclick={onToggle}
					disabled={!!rolledNote}
					title={rolledNote ?? (effect.enabled ? 'Disable' : 'Enable')}
				>
					<span class="toggle-knob"></span>
				</button>

				<button
					class="icon-btn"
					onclick={onDuplicate}
					title="Duplicate: adds an independent copy below"
					aria-label="Duplicate effect"
				>
					<Copy size={13} />
				</button>

				{#if isCopy}
					<button
						class="icon-btn"
						onclick={onHide}
						title="Remove this copy"
						aria-label="Remove effect copy"
					>
						<Trash2 size={14} />
					</button>
				{:else}
					<button
						class="icon-btn"
						onclick={onHide}
						title="Hide from the list. It stays hidden next session; restore it under Hidden effects."
						aria-label="Hide effect"
					>
						<EyeOff size={14} />
					</button>
				{/if}

				{#if !rolledChain}
				<div class="move-btns">
					<button
						class="move-btn"
						disabled={!canMoveUp}
						onclick={(e) => onMove(-1, e.shiftKey)}
						title="Move up (shift-click to send it to the top)"
						aria-label="Move effect up"
					>
						<ChevronUp size={13} />
					</button>
					<button
						class="move-btn"
						disabled={!canMoveDown}
						onclick={(e) => onMove(1, e.shiftKey)}
						title="Move down (shift-click to send it to the bottom)"
						aria-label="Move effect down"
					>
						<ChevronDown size={13} />
					</button>
				</div>

				<span
					class="drag-handle"
					title="Drag to reorder"
					onmousedown={() => (canDrag = true)}
					onmouseup={() => (canDrag = false)}
					ontouchstart={onTouchDragStart}
				>
					<GripVertical size={14} />
				</span>
				{/if}
			</div>
		</div>

		{#if effect.expanded && !rolledChain}
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
									value={+effect.values[param.key]}
									min={param.min}
									max={param.max}
									step={param.step}
									curve={param.curve}
									disabled={!!effect.volumeLinks?.[param.key]}
									oninput={(v) => onParamChange(param.key, v)}
									ondblclick={() =>
										onParamChange(param.key, param.defaultValue)}
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
												{#each FREQ_PRESET_BUTTONS as preset}
													<button
														type="button"
														class="freq-preset-btn"
														class:active={link.freqMin == preset.min &&
															link.freqMax == preset.max}
														title={preset.title}
														onclick={() =>
															onVolumeLinkChange(param.key, {
																...link,
																freqMin: preset.min,
																freqMax: preset.max,
															})}>{preset.label}</button
													>
												{/each}
											</div>
										</div>
										{#if link.freqMin != null && link.freqMax != null && spectrumData}
											<div class="spectrum-wrap">
												<SpectrumDisplay
													data={spectrumData.data}
													sampleRate={spectrumData.sampleRate}
													binCount={spectrumData.binCount}
													freqMin={link.freqMin ?? FREQ_PRESETS.full.min}
													freqMax={link.freqMax ?? FREQ_PRESETS.full.max}
													{response}
													width={200}
													height={48}
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
											title="Link to music volume (the slider follows the volume within a range)"
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
						{#if param.type === 'text'}
							<input
								id="{effect.instanceId}-{param.key}"
								class="text-input"
								type="text"
								value={effect.values[param.key]}
								maxlength={param.maxLength}
								placeholder={param.placeholder ?? ''}
								oninput={(e) => onParamChange(param.key, e.currentTarget.value)}
							/>
						{/if}
						{#if param.type === 'color'}
							<ColorPicker
								id="{effect.instanceId}-{param.key}"
								value={String(effect.values[param.key])}
								defaultValue={param.defaultValue}
								onChange={(hex) => onParamChange(param.key, hex)}
							/>
						{/if}
					</div>
				{/each}
			</div>
		{/if}
		</div>
	</div>
{/if}

<style>
	.effect-item {
		display: flex;
		align-items: stretch;
		position: relative;
		border-bottom: 1px solid rgba(255, 255, 255, 0.03);
	}

	/* Signal rail: dark when the effect is bypassed, lit when it passes signal. */
	.rail {
		position: relative;
		flex-shrink: 0;
		width: 30px;
		padding-top: 0.62rem;
		text-align: center;
	}

	.rail::after {
		content: '';
		position: absolute;
		top: 0;
		bottom: -1px;
		right: 0;
		width: 2px;
		border-radius: 1px;
		background: var(--line);
		transition:
			background var(--t),
			box-shadow var(--t);
	}

	.enabled .rail::after {
		background: var(--live);
		box-shadow: 0 0 10px rgba(110, 231, 192, 0.35);
	}

	.rail-index {
		font-size: 0.58rem;
		font-weight: 500;
		letter-spacing: 0.04em;
		color: var(--text-4);
		transition: color var(--t);
	}

	.enabled .rail-index {
		color: var(--live-dim);
	}

	.strip {
		flex: 1;
		min-width: 0;
	}

	.effect-item.enabled {
		background: rgba(110, 231, 192, 0.024);
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
		background: var(--live);
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
		padding: 0.45rem 0.55rem 0.45rem 0.6rem;
		gap: 0;
		color: var(--text-2);
		font-size: 0.78rem;
		transition: background var(--t-fast);
	}

	.header:hover {
		background: rgba(255, 255, 255, 0.03);
	}

	.enabled .header {
		color: var(--text);
	}

	.expand-trigger {
		display: flex;
		align-items: center;
		gap: 0.45rem;
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

	/* No drawer to open: keep the name in the same place, minus the affordance. */
	.expand-trigger.static {
		cursor: default;
		padding-left: 1.15rem;
	}

	.expand-arrow {
		font-size: 0.5rem;
		color: var(--text-4);
		transition:
			transform var(--t),
			color var(--t-fast);
		flex-shrink: 0;
		width: 0.7rem;
		text-align: center;
	}

	.expand-trigger:hover .expand-arrow {
		color: var(--text-2);
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
		letter-spacing: 0.005em;
	}

	.enabled .name {
		font-weight: 600;
	}

	.controls {
		display: flex;
		align-items: center;
		gap: 0.2rem;
		flex-shrink: 0;
	}

	/* Stacked so the pair costs one control's width, not two */
	.move-btns {
		display: flex;
		flex-direction: column;
		gap: 1px;
	}

	.move-btn {
		display: flex;
		align-items: center;
		justify-content: center;
		width: 18px;
		height: 11px;
		background: none;
		border: none;
		color: var(--text-4);
		cursor: pointer;
		border-radius: var(--r-2);
		padding: 0;
		transition:
			color var(--t-fast),
			background var(--t-fast);
	}

	.move-btn:hover:not(:disabled) {
		color: var(--text);
		background: rgba(255, 255, 255, 0.07);
	}

	.move-btn:disabled {
		opacity: 0.3;
		cursor: default;
	}

	/* Lit knob when the effect is passing signal. */
	.toggle {
		position: relative;
		width: 28px;
		height: 15px;
		border-radius: var(--r-pill);
		background: var(--sunken);
		border: 1px solid var(--line);
		cursor: pointer;
		padding: 0;
		margin-right: 0.15rem;
		transition:
			background var(--t),
			border-color var(--t);
	}

	/* Reporting, not controlling: dimmed so it doesn't invite a click, but not
	   so far that the live state stops reading. */
	.toggle:disabled {
		cursor: default;
		opacity: 0.55;
	}

	.toggle.on {
		border-color: var(--live-dim);
		background: rgba(110, 231, 192, 0.1);
	}

	.toggle-knob {
		position: absolute;
		top: 2px;
		left: 2px;
		width: 9px;
		height: 9px;
		border-radius: 50%;
		background: var(--text-4);
		transition:
			transform var(--t),
			background var(--t),
			box-shadow var(--t);
	}

	.toggle.on .toggle-knob {
		transform: translateX(13px);
		background: var(--live);
		box-shadow: 0 0 6px rgba(110, 231, 192, 0.7);
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
		color: var(--text-4);
		cursor: pointer;
		border-radius: var(--r-2);
		padding: 0;
		transition:
			color var(--t-fast),
			background var(--t-fast);
	}

	.icon-btn:hover {
		color: var(--text-2);
		background: rgba(255, 255, 255, 0.06);
	}

	.drag-handle {
		display: flex;
		align-items: center;
		justify-content: center;
		width: 20px;
		height: 22px;
		color: var(--text-4);
		cursor: grab;
		touch-action: none;
		user-select: none;
	}

	.drag-handle:hover {
		color: var(--text-2);
	}

	/* Params panel */
	.params {
		padding: 0.3rem 0.7rem 0.6rem 1.15rem;
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
		border-top: 1px solid rgba(255, 255, 255, 0.035);
		margin-top: 0.15rem;
		padding-top: 0.5rem;
	}

	.param-label {
		font-size: 0.7rem;
		font-weight: 400;
		letter-spacing: 0.01em;
		color: var(--text-3);
		min-width: 74px;
		flex-shrink: 0;
		padding-top: 0.1rem;
	}

	.param-value {
		font-family: var(--font-mono);
		font-size: 0.66rem;
		color: var(--text-2);
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

	.volume-link-btn {
		display: inline-flex;
		align-items: center;
		gap: 0.25rem;
		padding: 0.15rem 0.4rem;
		font-family: var(--font-mono);
		font-size: 0.6rem;
		letter-spacing: 0.06em;
		text-transform: uppercase;
		color: var(--text-3);
		background: none;
		border: 1px solid var(--line);
		border-radius: var(--r-pill);
		cursor: pointer;
		transition:
			color var(--t-fast),
			border-color var(--t-fast);
		flex-shrink: 0;
	}

	.volume-link-btn:hover {
		color: var(--live);
		border-color: var(--live-dim);
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
		font-family: var(--font-mono);
		font-size: 0.6rem;
		letter-spacing: 0.08em;
		text-transform: uppercase;
		color: var(--live-dim);
		flex-shrink: 0;
	}

	.volume-link-slider {
		flex: 1;
		min-width: 0;
	}

	.volume-invert-btn,
	.volume-unlink-btn {
		display: flex;
		align-items: center;
		justify-content: center;
		padding: 0.25rem;
		background: none;
		border: 1px solid var(--line);
		border-radius: 50%;
		color: var(--text-3);
		cursor: pointer;
		transition:
			color var(--t-fast),
			border-color var(--t-fast),
			background var(--t-fast);
	}

	.volume-invert-btn:hover,
	.volume-unlink-btn:hover {
		color: var(--text);
		border-color: var(--line-strong);
	}

	.volume-invert-btn.active {
		color: var(--live);
		border-color: var(--live-dim);
		background: rgba(110, 231, 192, 0.12);
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
		padding: 0.1rem 0.5rem;
		font-family: var(--font-mono);
		font-size: 0.58rem;
		letter-spacing: 0.08em;
		text-transform: uppercase;
		color: var(--text-3);
		background: none;
		border: 1px solid var(--line);
		border-radius: var(--r-pill);
		cursor: pointer;
		transition:
			color var(--t-fast),
			border-color var(--t-fast),
			background var(--t-fast);
	}

	.freq-preset-btn:hover {
		color: var(--text-2);
		border-color: var(--line-strong);
	}

	.freq-preset-btn.active {
		color: var(--live);
		border-color: var(--live-dim);
		background: rgba(110, 231, 192, 0.12);
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
		font-family: var(--font-mono);
		font-size: 0.6rem;
		letter-spacing: 0.08em;
		text-transform: uppercase;
		color: var(--live-dim);
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
		border: 1px solid var(--line-strong);
		border-radius: var(--r-2);
		background: var(--sunken);
		cursor: pointer;
		position: relative;
		flex-shrink: 0;
	}

	input[type='checkbox']:hover {
		border-color: var(--text-3);
	}

	input[type='checkbox']:checked {
		background: rgba(110, 231, 192, 0.15);
		border-color: var(--live-dim);
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
		background: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 12 12'%3E%3Cpath d='M2.5 6l2.5 2.5 4.5-5' stroke='%236ee7c0' stroke-width='1.8' fill='none' stroke-linecap='round' stroke-linejoin='round'/%3E%3C/svg%3E")
			center/contain no-repeat;
	}

	select {
		flex: 1;
		background: var(--sunken);
		color: var(--text-2);
		border: 1px solid var(--line);
		border-radius: var(--r-2);
		padding: 0.25rem 0.45rem;
		font-family: var(--font-mono);
		font-size: 0.66rem;
		cursor: pointer;
		outline: none;
	}

	select:focus {
		border-color: var(--line-strong);
	}

	.text-input {
		flex: 1;
		min-width: 0;
		background: var(--sunken);
		color: var(--text);
		border: 1px solid var(--line);
		border-radius: var(--r-2);
		padding: 0.25rem 0.45rem;
		font-family: inherit;
		font-size: 0.72rem;
		outline: none;
	}

	.text-input:focus {
		border-color: var(--line-strong);
	}
</style>
