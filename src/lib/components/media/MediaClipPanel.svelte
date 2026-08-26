<script lang="ts">
	import { X } from 'lucide-svelte';
	import { OPAQUE_OUTPUT_EFFECTS } from '../../gl/effect-shaders';
	import { LaneEffects } from '../../timeline/lane-effects.svelte';
	import {
		DEFAULT_MEDIA_STYLE,
		MEDIA_FIT_OPTIONS,
		type MediaClip,
		type MediaLane,
		type MediaStyle,
	} from '../../media';
	import type { SequenceSource } from '../../editor/sequence-sources.svelte';
	import type { SpectrumData } from '../../types';
	import type { AudioResponse } from '../../audio/auto-range';
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
		/** The lane the selected clip lives in; the panel edits its style. */
		lane: MediaLane | null;
		clip: MediaClip | null;
		/** The media pool this layer can draw from. */
		sources?: SequenceSource[];
		onLaneChange: (lane: MediaLane) => void;
		onClipChange: (clip: MediaClip) => void;
		onBeforeEdit?: (coalesceKey?: string) => void;
		/** Deselects the clip, which puts the image effects back in the sidebar. */
		onClose?: () => void;
		hasTrack?: boolean;
		spectrumData?: SpectrumData | null;
		/** Forwarded to the lane's effect panel for its spectrum read-out. */
		response?: AudioResponse;
	}

	let {
		lane,
		clip,
		sources = [],
		onLaneChange,
		onClipChange,
		onBeforeEdit,
		onClose,
		hasTrack = false,
		spectrumData = null,
		response = undefined,
	}: Props = $props();

	let source = $derived(sources.find((s) => s.id === lane?.sourceId));

	function setUnderEffects(under: boolean) {
		if (!lane) return;
		onBeforeEdit?.();
		onLaneChange({ ...lane, underEffects: under });
	}

	function setStyle<K extends keyof MediaStyle>(
		key: K,
		value: MediaStyle[K],
		coalesceKey?: string,
	) {
		if (!lane) return;
		onBeforeEdit?.(coalesceKey);
		onLaneChange({ ...lane, style: { ...lane.style, [key]: value } });
	}

	/** Double-clicking a row puts that style back to the default. */
	function resetStyle(e: MouseEvent, key: keyof MediaStyle) {
		const t = e.target as HTMLElement | null;
		if (t?.closest('input[type="text"], textarea')) return;
		setStyle(key, DEFAULT_MEDIA_STYLE[key]);
	}

	function setSource(id: string) {
		if (!lane) return;
		onBeforeEdit?.();
		onLaneChange({ ...lane, sourceId: id });
	}

	function setSourceStart(v: number) {
		if (!clip) return;
		onBeforeEdit?.(`media-in-${clip.id}`);
		onClipChange({ ...clip, sourceStart: v });
	}

	// The lane's chain, mirrored for EffectsPanel to own and written back on
	// every edit. Handled here rather than by the editor: the chain on show is
	// this mirror, so the editor has nothing to apply an edit to.
	const chain = new LaneEffects(
		() => lane,
		(next) => onLaneChange(next),
		(key) => onBeforeEdit?.(key),
	);
	$effect(() => chain.sync());

	let opaqueNames = $derived(
		chain.effects
			.filter((e) => e.enabled && OPAQUE_OUTPUT_EFFECTS.has(e.defId))
			.map((e) => e.defId),
	);
</script>

{#if !clip || !lane}
	<p class="empty">Select a layer clip to edit it.</p>
{:else}
	<div class="clip-panel">
		<div class="panel-head">
			<h3 class="panel-title">
				{lane.name}
				{#if source}<span class="panel-src">{source.name}</span>{/if}
			</h3>
			{#if onClose}
				<button
					class="close-btn"
					onclick={onClose}
					title="Close (Esc)"
					aria-label="Close layer clip"
				>
					<X size={14} />
				</button>
			{/if}
		</div>

		{#if !lane.sourceId}
			<p class="warn">
				This layer has nothing to draw — drag a thumb from the media rail onto
				its row.
			</p>
		{/if}

		{#if source?.kind === 'video' && source.duration > 0}
			<!-- svelte-ignore a11y_no_static_element_interactions -->
			<div class="row" title="Where in the video this clip starts">
				<label for="mc-in">Start at</label>
				<RangeSlider
					id="mc-in"
					value={Math.min(clip.sourceStart, source.duration)}
					min={0}
					max={source.duration}
					step={0.05}
					oninput={setSourceStart}
				/>
				<span class="val">{clip.sourceStart.toFixed(1)}s</span>
			</div>
		{/if}

		<!-- svelte-ignore a11y_no_static_element_interactions -->
		<div
			class="row"
			title="Double-click to reset"
			ondblclick={(e) => resetStyle(e, 'fit')}
		>
			<label for="mc-fit">Fit</label>
			<select
				id="mc-fit"
				value={lane.style.fit}
				onchange={(e) =>
					setStyle(
						'fit',
						(e.currentTarget as HTMLSelectElement).value as MediaStyle['fit'],
					)}
			>
				{#each MEDIA_FIT_OPTIONS as opt (opt.value)}
					<option value={opt.value}>{opt.label}</option>
				{/each}
			</select>
		</div>

		<!-- svelte-ignore a11y_no_static_element_interactions -->
		<div
			class="row"
			title="Double-click to reset"
			ondblclick={(e) => resetStyle(e, 'scale')}
		>
			<label for="mc-scale">Scale</label>
			<RangeSlider
				id="mc-scale"
				value={lane.style.scale}
				min={0.05}
				max={3}
				step={0.01}
				oninput={(v) => setStyle('scale', v, `mc-scale-${lane.id}`)}
			/>
			<span class="val">{Math.round(lane.style.scale * 100)}%</span>
		</div>

		<!-- svelte-ignore a11y_no_static_element_interactions -->
		<div
			class="row"
			title="Double-click to reset"
			ondblclick={(e) => resetStyle(e, 'x')}
		>
			<label for="mc-x">Position X</label>
			<RangeSlider
				id="mc-x"
				value={lane.style.x}
				min={-0.5}
				max={1.5}
				step={0.005}
				oninput={(v) => setStyle('x', v, `mc-x-${lane.id}`)}
			/>
			<span class="val">{Math.round(lane.style.x * 100)}</span>
		</div>

		<!-- svelte-ignore a11y_no_static_element_interactions -->
		<div
			class="row"
			title="Double-click to reset"
			ondblclick={(e) => resetStyle(e, 'y')}
		>
			<label for="mc-y">Position Y</label>
			<RangeSlider
				id="mc-y"
				value={lane.style.y}
				min={-0.5}
				max={1.5}
				step={0.005}
				oninput={(v) => setStyle('y', v, `mc-y-${lane.id}`)}
			/>
			<span class="val">{Math.round(lane.style.y * 100)}</span>
		</div>

		<!-- svelte-ignore a11y_no_static_element_interactions -->
		<div
			class="row"
			title="Double-click to reset"
			ondblclick={(e) => resetStyle(e, 'rotation')}
		>
			<label for="mc-rot">Rotation</label>
			<RangeSlider
				id="mc-rot"
				value={lane.style.rotation}
				min={-180}
				max={180}
				step={1}
				oninput={(v) => setStyle('rotation', v, `mc-rot-${lane.id}`)}
			/>
			<span class="val">{Math.round(lane.style.rotation)}°</span>
		</div>

		<!-- svelte-ignore a11y_no_static_element_interactions -->
		<div
			class="row"
			title="Double-click to reset"
			ondblclick={(e) => resetStyle(e, 'opacity')}
		>
			<label for="mc-opacity">Opacity</label>
			<RangeSlider
				id="mc-opacity"
				value={lane.style.opacity}
				min={0}
				max={1}
				step={0.01}
				oninput={(v) => setStyle('opacity', v, `mc-op-${lane.id}`)}
			/>
			<span class="val">{Math.round(lane.style.opacity * 100)}%</span>
		</div>

		<!-- svelte-ignore a11y_no_static_element_interactions -->
		<div
			class="row"
			title="Double-click to reset"
			ondblclick={(e) => resetStyle(e, 'blendMode')}
		>
			<label for="mc-blend">Blend</label>
			<select
				id="mc-blend"
				value={lane.style.blendMode}
				onchange={(e) =>
					setStyle(
						'blendMode',
						(e.currentTarget as HTMLSelectElement)
							.value as MediaStyle['blendMode'],
					)}
			>
				{#each BLEND_MODES as mode (mode)}
					<option value={mode}>{mode}</option>
				{/each}
			</select>
		</div>


		<!-- svelte-ignore a11y_no_static_element_interactions -->
		<div
			class="row"
			title="Composite before the image effects instead of over the finished frame, so they distort the layer too"
		>
			<label for="mc-under">Under effects</label>
			<input
				id="mc-under"
				type="checkbox"
				checked={lane.underEffects}
				onchange={(e) =>
					setUnderEffects((e.currentTarget as HTMLInputElement).checked)}
			/>
		</div>

		<h3 class="panel-title section">Layer effects</h3>
		<p class="hint">
			Run on this layer alone, before it meets the image. One that spreads —
			a blur, a bloom, a displacement — carries past the layer's edges.
		</p>
		{#if opaqueNames.length > 0}
			<p class="warn">
				{opaqueNames.join(', ')} paints its own background, so it fills the frame
				instead of following the layer.
			</p>
		{/if}
		<EffectsPanel
			bind:effects={() => chain.effects, (v) => (chain.effects = v)}
			{hasTrack}
			{spectrumData}
			{response}
			onVolumeLinkChange={(i, key, link) => chain.linkChange(i, key, link)}
			onUserEdit={() => chain.commit()}
			onEffectsReplaced={() => chain.commit()}
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
		/* Sits at the top of the sidebar and keeps its natural height: the
		   sidebar is one scroll region, so a scrollbar here would strand the
		   settings below it at the bottom of the window. */
		flex: 0 0 auto;
		border-bottom: 1px solid var(--line);
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

	/* Full-bleed, matching the sidebar chain this panel replaces. It is the last
	   section, so it owns the bottom edge too: padding under an edge-to-edge
	   list reads as a dead band above the settings that follow. */
	.clip-panel :global(aside.effects-panel) {
		margin: 0 -0.75rem -0.75rem;
		width: auto;
		max-width: none;
	}

	.panel-head {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: 0.5rem;
	}

	.panel-src {
		margin-left: 0.4rem;
		font-weight: 400;
		letter-spacing: 0;
		text-transform: none;
		color: var(--text-4);
	}

	.panel-title {
		margin: 0;
		font-size: 0.7rem;
		font-weight: 600;
		letter-spacing: 0.08em;
		text-transform: uppercase;
		color: var(--text-3);
	}

	.panel-title.section {
		margin-top: 0.5rem;
		padding-top: 0.6rem;
		border-top: 1px solid var(--line);
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

	.row select {
		flex: 1;
		min-width: 0;
		padding: 0.2rem 0.3rem;
		border: 1px solid var(--line);
		border-radius: 4px;
		background: var(--surface);
		color: var(--text);
		font-size: 0.75rem;
		font-family: inherit;
	}

	.val {
		min-width: 40px;
		text-align: right;
		color: var(--text-3);
		font-size: 0.75rem;
	}

	.hint,
	.warn {
		margin: 0;
		font-size: 0.68rem;
		line-height: 1.35;
		color: var(--text-3);
	}

	.warn {
		color: #d9a441;
	}

	.empty {
		padding: 1rem;
		font-size: 0.75rem;
		color: var(--text-3);
	}
</style>
