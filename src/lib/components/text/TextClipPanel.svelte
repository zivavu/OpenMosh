<script lang="ts">
	import { untrack } from 'svelte';
	import type { EffectInstance, VolumeLink } from '../../effects';
	import { OPAQUE_OUTPUT_EFFECTS } from '../../gl/effect-shaders';
	import { ensureFontLoaded, FONT_OPTIONS } from '../../text-overlay';
	import type { TextAlign, TextClip, TextStyle } from '../../text';
	import type { SpectrumData } from '../../types';
	import ColorPicker from '../ui/ColorPicker.svelte';
	import EffectsPanel from '../ui/EffectsPanel.svelte';
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
		clip: TextClip | null;
		onChange: (clip: TextClip) => void;
		onBeforeEdit?: (coalesceKey?: string) => void;
		hasTrack?: boolean;
		spectrumData?: SpectrumData | null;
		onVolumeLinkChange?: (
			index: number,
			paramKey: string,
			link: VolumeLink | null,
		) => void;
	}

	let {
		clip,
		onChange,
		onBeforeEdit,
		hasTrack = false,
		spectrumData = null,
		onVolumeLinkChange,
	}: Props = $props();

	function setStyle<K extends keyof TextStyle>(
		key: K,
		value: TextStyle[K],
		coalesceKey?: string,
	) {
		if (!clip) return;
		onBeforeEdit?.(coalesceKey);
		onChange({ ...clip, style: { ...clip.style, [key]: value } });
	}

	function setText(text: string) {
		if (!clip) return;
		onBeforeEdit?.(`text-body-${clip.id}`);
		onChange({ ...clip, text });
	}

	// EffectsPanel owns its array (it mutates and reassigns), so the clip's chain
	// is mirrored into local state and written back on every edit. Keyed on the
	// clip id so switching selection reloads rather than cross-contaminates.
	let clipEffects = $state<EffectInstance[]>([]);
	let loadedClipId = $state<string | null>(null);

	$effect(() => {
		const id = clip?.id ?? null;
		if (id === untrack(() => loadedClipId)) return;
		loadedClipId = id;
		clipEffects = clip ? [...clip.effects] : [];
	});

	function commitEffects() {
		if (!clip) return;
		onChange({ ...clip, effects: $state.snapshot(clipEffects) as EffectInstance[] });
	}

	let opaqueNames = $derived(
		clipEffects
			.filter((e) => e.enabled && OPAQUE_OUTPUT_EFFECTS.has(e.defId))
			.map((e) => e.defId),
	);
</script>

{#if !clip}
	<p class="empty">Select a text clip to edit it.</p>
{:else}
	<div class="clip-panel">
		<h3 class="panel-title">Text</h3>

		<textarea
			class="text-input"
			placeholder="Type the text for this clip"
			value={clip.text}
			oninput={(e) => setText((e.currentTarget as HTMLTextAreaElement).value)}
		></textarea>

		<div class="row">
			<label for="tc-font">Font</label>
			<select
				id="tc-font"
				value={clip.style.fontFamily}
				onchange={(e) => {
					const family = (e.currentTarget as HTMLSelectElement).value;
					void ensureFontLoaded(family);
					setStyle('fontFamily', family);
				}}
			>
				{#each FONT_OPTIONS as font (font.id)}
					<option value={font.family}>{font.label}</option>
				{/each}
			</select>
		</div>

		<div class="row">
			<label for="tc-size">Size</label>
			<RangeSlider
				id="tc-size"
				value={clip.style.size}
				min={0.02}
				max={0.5}
				step={0.005}
				oninput={(v) => setStyle('size', v, `tc-size-${clip.id}`)}
			/>
			<span class="val">{Math.round(clip.style.size * 100)}%</span>
		</div>

		<div class="row">
			<label for="tc-align">Align</label>
			<select
				id="tc-align"
				value={clip.style.align}
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

		<div class="row">
			<label for="tc-x">Position X</label>
			<RangeSlider
				id="tc-x"
				value={clip.style.x}
				min={0}
				max={1}
				step={0.01}
				oninput={(v) => setStyle('x', v, `tc-x-${clip.id}`)}
			/>
			<span class="val">{Math.round(clip.style.x * 100)}</span>
		</div>

		<div class="row">
			<label for="tc-y">Position Y</label>
			<RangeSlider
				id="tc-y"
				value={clip.style.y}
				min={0}
				max={1}
				step={0.01}
				oninput={(v) => setStyle('y', v, `tc-y-${clip.id}`)}
			/>
			<span class="val">{Math.round(clip.style.y * 100)}</span>
		</div>

		<div class="row">
			<label for="tc-color">Color</label>
			<ColorPicker
				id="tc-color"
				value={clip.style.color}
				defaultValue="#ffffff"
				onChange={(hex) => setStyle('color', hex)}
			/>
		</div>

		<div class="row">
			<label for="tc-outline">Outline</label>
			<input
				id="tc-outline"
				type="checkbox"
				checked={clip.style.outline}
				onchange={(e) =>
					setStyle('outline', (e.currentTarget as HTMLInputElement).checked)}
			/>
		</div>

		{#if clip.style.outline}
			<div class="row">
				<label for="tc-outline-color">Outline color</label>
				<ColorPicker
					id="tc-outline-color"
					value={clip.style.outlineColor}
					defaultValue="#000000"
					onChange={(hex) => setStyle('outlineColor', hex)}
				/>
			</div>
			<div class="row">
				<label for="tc-outline-w">Outline width</label>
				<RangeSlider
					id="tc-outline-w"
					value={clip.style.outlineWidth}
					min={0}
					max={8}
					step={0.5}
					oninput={(v) => setStyle('outlineWidth', v, `tc-ow-${clip.id}`)}
				/>
				<span class="val">{clip.style.outlineWidth}</span>
			</div>
		{/if}

		<div class="row">
			<label for="tc-opacity">Opacity</label>
			<RangeSlider
				id="tc-opacity"
				value={clip.style.opacity}
				min={0}
				max={1}
				step={0.01}
				oninput={(v) => setStyle('opacity', v, `tc-op-${clip.id}`)}
			/>
			<span class="val">{Math.round(clip.style.opacity * 100)}%</span>
		</div>

		<div class="row">
			<label for="tc-blend">Blend</label>
			<select
				id="tc-blend"
				value={clip.style.blendMode}
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
		<p class="note">
			These run on the text alone, before it meets the image. The lane's chain
			position decides which image effects hit it afterwards.
		</p>
		{#if opaqueNames.length > 0}
			<p class="warn">
				{opaqueNames.join(', ')} paints its own background, so it fills the frame
				instead of following the letters.
			</p>
		{/if}
		<EffectsPanel
			bind:effects={clipEffects}
			{hasTrack}
			{spectrumData}
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
	}

	.empty {
		padding: 0.75rem;
		color: #666;
		font-size: 0.75rem;
	}

	.panel-title {
		font-size: 0.7rem;
		font-weight: 600;
		letter-spacing: 0.08em;
		color: #888;
		text-transform: uppercase;
	}

	.section {
		margin-top: 0.5rem;
		padding-top: 0.6rem;
		border-top: 1px solid #2a2a2a;
	}

	.note {
		color: #666;
		font-size: 0.68rem;
		line-height: 1.35;
	}

	.warn {
		color: #d9a441;
		font-size: 0.68rem;
		line-height: 1.35;
	}

	.text-input {
		min-height: 60px;
		padding: 0.35rem;
		border: 1px solid #333;
		border-radius: 4px;
		background: #1a1a1a;
		color: #e0e0e0;
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
		color: #999;
		font-size: 0.75rem;
	}

	.row select {
		flex: 1;
		padding: 0.2rem 0.3rem;
		border: 1px solid #333;
		border-radius: 4px;
		background: #1a1a1a;
		color: #e0e0e0;
		font-size: 0.75rem;
		font-family: inherit;
	}

	.row input[type='checkbox'] {
		accent-color: #888;
	}

	.val {
		min-width: 34px;
		text-align: right;
		color: #888;
		font-size: 0.75rem;
	}
</style>
