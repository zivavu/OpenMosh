<script lang="ts">
	import { X } from 'lucide-svelte';
	import { untrack } from 'svelte';
	import type { EffectInstance, VolumeLink } from '../../effects';
	import { OPAQUE_OUTPUT_EFFECTS } from '../../gl/effect-shaders';
	import { ensureFontLoaded } from '../../text-overlay';
	import {
		DEFAULT_TEXT_STYLE,
		type TextAlign,
		type TextClip,
		type TextLane,
		type TextStyle,
	} from '../../text';
	import type { SpectrumData } from '../../types';
	import type { AudioResponse } from '../../audio/auto-range';
	import ColorPicker from '../ui/ColorPicker.svelte';
	import EffectsPanel from '../ui/EffectsPanel.svelte';
	import FontSelect from '../ui/FontSelect.svelte';
	import RangeSlider from '../ui/RangeSlider.svelte';

	const BLEND_MODES = [
		'normal',
		'multiply',
		'screen',
		'overlay',
		'add',
		'subtract',
		'difference',
		'exclusion',
	] as const;

	interface Props {
		/** The lane the selected clip lives in; the panel edits its style. */
		lane: TextLane | null;
		clip: TextClip | null;
		onLaneChange: (lane: TextLane) => void;
		onClipChange: (clip: TextClip) => void;
		onBeforeEdit?: (coalesceKey?: string) => void;
		/** Deselects the clip, which puts the image effects back in the sidebar. */
		onClose?: () => void;
		hasTrack?: boolean;
		spectrumData?: SpectrumData | null;
		/** Forwarded to the lane's effect panel for its spectrum read-out. */
		response?: AudioResponse;
		onVolumeLinkChange?: (
			index: number,
			paramKey: string,
			link: VolumeLink | null,
		) => void;
	}

	let {
		lane,
		clip,
		onLaneChange,
		onClipChange,
		onBeforeEdit,
		onClose,
		hasTrack = false,
		spectrumData = null,
		response = undefined,
		onVolumeLinkChange,
	}: Props = $props();

	function setStyle<K extends keyof TextStyle>(
		key: K,
		value: TextStyle[K],
		coalesceKey?: string,
	) {
		if (!lane) return;
		onBeforeEdit?.(coalesceKey);
		onLaneChange({ ...lane, style: { ...lane.style, [key]: value } });
	}

	/**
	 * Double-clicking a row — its label, its slider, its checkbox, its swatch —
	 * puts that style back to the default. Bound on the row rather than the
	 * control so it also reaches a native select, whose open popup swallows the
	 * second click. Text fields and the open colour picker are left alone, so
	 * double-click-to-select-a-word and picking a preset still work.
	 */
	function resetStyle(e: MouseEvent, key: keyof TextStyle) {
		const t = e.target as HTMLElement | null;
		if (t?.closest('input[type="text"], textarea, .picker')) return;
		setStyle(key, DEFAULT_TEXT_STYLE[key]);
	}

	function setText(text: string) {
		if (!clip) return;
		onBeforeEdit?.(`text-body-${clip.id}`);
		onClipChange({ ...clip, text });
	}

	// EffectsPanel owns its array (it mutates and reassigns), so the lane's chain
	// is mirrored into local state and written back on every edit. Keyed on the
	// lane id so switching lanes reloads rather than cross-contaminates.
	let laneEffects = $state<EffectInstance[]>([]);
	let loadedLaneId = $state<string | null>(null);

	$effect(() => {
		const id = lane?.id ?? null;
		if (id === untrack(() => loadedLaneId)) return;
		loadedLaneId = id;
		laneEffects = lane ? [...lane.effects] : [];
	});

	function commitEffects() {
		if (!lane) return;
		onLaneChange({
			...lane,
			effects: $state.snapshot(laneEffects) as EffectInstance[],
		});
	}

	let opaqueNames = $derived(
		laneEffects
			.filter((e) => e.enabled && OPAQUE_OUTPUT_EFFECTS.has(e.defId))
			.map((e) => e.defId),
	);
</script>

{#if !clip || !lane}
	<p class="empty">Select a text clip to edit it.</p>
{:else}
	<div class="clip-panel">
		<div class="panel-head">
			<h3 class="panel-title">{lane.name}</h3>
			{#if onClose}
				<button
					class="close-btn"
					onclick={onClose}
					title="Close (Esc)"
					aria-label="Close text clip"
				>
					<X size={14} />
				</button>
			{/if}
		</div>
		<textarea
			class="text-input"
			placeholder="Type the text for this clip"
			value={clip.text}
			oninput={(e) => setText((e.currentTarget as HTMLTextAreaElement).value)}
		></textarea>

		<!-- svelte-ignore a11y_no_static_element_interactions -->
		<div
			class="row"
			title="Double-click to reset"
			ondblclick={(e) => {
				void ensureFontLoaded(DEFAULT_TEXT_STYLE.fontFamily);
				resetStyle(e, 'fontFamily');
			}}
		>
			<label for="tc-font">Font</label>
			<FontSelect
				id="tc-font"
				value={lane.style.fontFamily}
				onChange={(family) => setStyle('fontFamily', family)}
			/>
		</div>

		<!-- svelte-ignore a11y_no_static_element_interactions -->
		<div
			class="row"
			title="Double-click to reset"
			ondblclick={(e) => resetStyle(e, 'size')}
		>
			<label for="tc-size">Size</label>
			<RangeSlider
				id="tc-size"
				value={lane.style.size}
				min={0.02}
				max={0.5}
				step={0.005}
				oninput={(v) => setStyle('size', v, `tc-size-${clip.id}`)}
			/>
			<span class="val">{Math.round(lane.style.size * 100)}%</span>
		</div>

		<!-- svelte-ignore a11y_no_static_element_interactions -->
		<div
			class="row"
			title="Double-click to reset"
			ondblclick={(e) => resetStyle(e, 'align')}
		>
			<label for="tc-align">Align</label>
			<select
				id="tc-align"
				value={lane.style.align}
				onchange={(e) =>
					setStyle(
						'align',
						(e.currentTarget as HTMLSelectElement).value as TextAlign,
					)}
			>
				<option value="left">Left</option>
				<option value="center">Center</option>
				<option value="right">Right</option>
			</select>
		</div>

		<!-- svelte-ignore a11y_no_static_element_interactions -->
		<div
			class="row"
			title="Double-click to reset"
			ondblclick={(e) => resetStyle(e, 'x')}
		>
			<label for="tc-x">Position X</label>
			<RangeSlider
				id="tc-x"
				value={lane.style.x}
				min={0}
				max={1}
				step={0.01}
				oninput={(v) => setStyle('x', v, `tc-x-${clip.id}`)}
			/>
			<span class="val">{Math.round(lane.style.x * 100)}</span>
		</div>

		<!-- svelte-ignore a11y_no_static_element_interactions -->
		<div
			class="row"
			title="Double-click to reset"
			ondblclick={(e) => resetStyle(e, 'y')}
		>
			<label for="tc-y">Position Y</label>
			<RangeSlider
				id="tc-y"
				value={lane.style.y}
				min={0}
				max={1}
				step={0.01}
				oninput={(v) => setStyle('y', v, `tc-y-${clip.id}`)}
			/>
			<span class="val">{Math.round(lane.style.y * 100)}</span>
		</div>

		<!-- svelte-ignore a11y_no_static_element_interactions -->
		<div
			class="row"
			title="Double-click to reset"
			ondblclick={(e) => resetStyle(e, 'color')}
		>
			<label for="tc-color">Color</label>
			<ColorPicker
				id="tc-color"
				value={lane.style.color}
				defaultValue="#ffffff"
				onChange={(hex) => setStyle('color', hex)}
			/>
		</div>

		<!-- svelte-ignore a11y_no_static_element_interactions -->
		<div
			class="row"
			title="Double-click to reset"
			ondblclick={(e) => resetStyle(e, 'outline')}
		>
			<label for="tc-outline">Outline</label>
			<input
				id="tc-outline"
				type="checkbox"
				checked={lane.style.outline}
				onchange={(e) =>
					setStyle('outline', (e.currentTarget as HTMLInputElement).checked)}
			/>
		</div>

		{#if lane.style.outline}
			<!-- svelte-ignore a11y_no_static_element_interactions -->
			<div
				class="row"
				title="Double-click to reset"
				ondblclick={(e) => resetStyle(e, 'outlineColor')}
			>
				<label for="tc-outline-color">Outline color</label>
				<ColorPicker
					id="tc-outline-color"
					value={lane.style.outlineColor}
					defaultValue="#000000"
					onChange={(hex) => setStyle('outlineColor', hex)}
				/>
			</div>
			<!-- svelte-ignore a11y_no_static_element_interactions -->
			<div
				class="row"
				title="Double-click to reset"
				ondblclick={(e) => resetStyle(e, 'outlineWidth')}
			>
				<label for="tc-outline-w">Outline width</label>
				<RangeSlider
					id="tc-outline-w"
					value={lane.style.outlineWidth}
					min={0}
					max={8}
					step={0.5}
					oninput={(v) => setStyle('outlineWidth', v, `tc-ow-${clip.id}`)}
				/>
				<span class="val">{lane.style.outlineWidth}</span>
			</div>
		{/if}

		<!-- svelte-ignore a11y_no_static_element_interactions -->
		<div
			class="row"
			title="Double-click to reset"
			ondblclick={(e) => resetStyle(e, 'opacity')}
		>
			<label for="tc-opacity">Opacity</label>
			<RangeSlider
				id="tc-opacity"
				value={lane.style.opacity}
				min={0}
				max={1}
				step={0.01}
				oninput={(v) => setStyle('opacity', v, `tc-op-${clip.id}`)}
			/>
			<span class="val">{Math.round(lane.style.opacity * 100)}%</span>
		</div>

		<!-- svelte-ignore a11y_no_static_element_interactions -->
		<div
			class="row"
			title="Double-click to reset"
			ondblclick={(e) => resetStyle(e, 'blendMode')}
		>
			<label for="tc-blend">Blend</label>
			<select
				id="tc-blend"
				value={lane.style.blendMode}
				onchange={(e) =>
					setStyle(
						'blendMode',
						(e.currentTarget as HTMLSelectElement)
							.value as TextStyle['blendMode'],
					)}
			>
				{#each BLEND_MODES as mode (mode)}
					<option value={mode}>{mode}</option>
				{/each}
			</select>
		</div>

		<h3 class="panel-title section">Text effects</h3>
		{#if opaqueNames.length > 0}
			<p class="warn">
				{opaqueNames.join(', ')} paints its own background, so it fills the frame
				instead of following the letters.
			</p>
		{/if}
		<EffectsPanel
			bind:effects={laneEffects}
			{hasTrack}
			{spectrumData}
			{response}
			{onVolumeLinkChange}
			onUserEdit={commitEffects}
			onEffectsReplaced={commitEffects}
			onBeforeUserEdit={onBeforeEdit}
		/>
	</div>
{/if}

<style>
	.clip-panel {
		display: flex;
		flex-direction: column;
		gap: 0.4rem;
		padding: 0.75rem;
		/* Takes the sidebar's leftover height and scrolls as one region — the
		   fields and the nested chain together. The chain used to scroll on its
		   own, which left the sidebar with no scrollbar at all when this panel
		   replaced it, and the lower rows simply ran off the bottom. */
		flex: 1;
		min-height: 0;
		overflow-y: auto;
		/* Matches the effects panel this replaces. Without a width the sidebar is
		   sized by this panel's content, and the help text alone is a single
		   unbroken max-content line — enough to stretch the sidebar across the
		   window the moment a clip is selected. */
		width: 310px;
		max-width: 310px;
		box-sizing: border-box;
	}

	@media (max-width: 800px) {
		.clip-panel {
			width: 100%;
			max-width: 100%;
		}
	}

	/* Nothing shrinks: children keep their natural height and the panel scrolls. */
	.clip-panel > :global(*) {
		flex-shrink: 0;
	}

	.clip-panel::-webkit-scrollbar {
		width: 4px;
	}

	.clip-panel::-webkit-scrollbar-track {
		background: transparent;
	}

	.clip-panel::-webkit-scrollbar-thumb {
		background: rgba(255, 255, 255, 0.07);
		border-radius: 2px;
	}

	.clip-panel::-webkit-scrollbar-thumb:hover {
		background: #555;
	}

	/* The nested chain carries the same padding as it does in the sidebar, so it
	   goes full-bleed here — inside this panel's padding too it sat in a double
	   inset, reading as a sunken box rather than a continuation of the panel. */
	.clip-panel :global(aside.effects-panel) {
		/* Its own `flex: 1` is for owning the sidebar's height; here the scroll
		   belongs to this panel, so it takes its content height instead. */
		flex: 0 0 auto;
		width: auto;
		max-width: none;
		margin: 0 -0.75rem -0.75rem;
	}

	.empty {
		padding: 0.75rem;
		color: var(--text-3);
		font-size: 0.75rem;
	}

	/* The lane names the panel; the clip's own text is the box below, so it is
	   not repeated up here. */
	.panel-head {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: 0.5rem;
	}

	.close-btn {
		display: flex;
		align-items: center;
		flex-shrink: 0;
		padding: 2px;
		border: none;
		border-radius: 4px;
		background: none;
		color: var(--text-3);
		cursor: pointer;
	}

	.close-btn:hover {
		color: var(--text);
	}

	.panel-title {
		font-size: 0.7rem;
		font-weight: 600;
		letter-spacing: 0.08em;
		color: var(--text-3);
		text-transform: uppercase;
	}

	.section {
		margin-top: 0.5rem;
		padding-top: 0.6rem;
		border-top: 1px solid var(--line);
	}


	.warn {
		color: #d9a441;
		font-size: 0.68rem;
		line-height: 1.35;
	}

	.text-input {
		min-height: 60px;
		/* A textarea carries an intrinsic `cols` width that ignores the flex
		   column it sits in. */
		width: 100%;
		box-sizing: border-box;
		padding: 0.35rem;
		border: 1px solid var(--line);
		border-radius: 4px;
		background: var(--surface);
		color: var(--text);
		font-size: 0.78rem;
		font-family: inherit;
		resize: vertical;
	}

	.row {
		display: flex;
		align-items: center;
		gap: 0.5rem;
		font-size: 0.78rem;
	}

	.row label {
		flex-shrink: 0;
		min-width: 84px;
		color: var(--text-2);
		font-size: 0.75rem;
		/* The row's double-click resets the style; without this it also selects
		   the label text. */
		user-select: none;
	}

	.row :global(.font-select) {
		flex: 1;
		min-width: 0;
	}

	/* The font picker is its own component, so the row's select styling has to
	   reach across the boundary to keep it looking like the rest of the panel. */
	.row :global(.font-select select) {
		padding: 0.2rem 0.3rem;
		border-radius: 4px;
		background: var(--surface);
		color: var(--text);
		font-family: inherit;
		font-size: 0.75rem;
	}

	.row select {
		flex: 1;
		/* Font names are long; without this the select refuses to shrink below
		   its widest option and pushes the row wider than the panel. */
		min-width: 0;
		padding: 0.2rem 0.3rem;
		border: 1px solid var(--line);
		border-radius: 4px;
		background: var(--surface);
		color: var(--text);
		font-size: 0.75rem;
		font-family: inherit;
	}

	.row input[type='checkbox'] {
		accent-color: #888;
	}

	.val {
		min-width: 34px;
		text-align: right;
		color: var(--text-3);
		font-size: 0.75rem;
	}
</style>
