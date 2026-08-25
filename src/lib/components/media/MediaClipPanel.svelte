<script lang="ts">
	import { Plus, X } from 'lucide-svelte';
	import { untrack } from 'svelte';
	import type { EffectInstance, VolumeLink } from '../../effects';
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
		/** Opens the file picker that adds to the pool. */
		onAddSource?: () => void;
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
		sources = [],
		onLaneChange,
		onClipChange,
		onBeforeEdit,
		onAddSource,
		onClose,
		hasTrack = false,
		spectrumData = null,
		response = undefined,
		onVolumeLinkChange,
	}: Props = $props();

	let source = $derived(sources.find((s) => s.id === lane?.sourceId));

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
</script>

{#if !clip || !lane}
	<p class="empty">Select a layer clip to edit it.</p>
{:else}
	<div class="clip-panel">
		<div class="panel-head">
			<h3 class="panel-title">{lane.name}</h3>
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

		<div class="src-grid">
			{#each sources as s (s.id)}
				<button
					class="src-chip"
					class:active={s.id === lane.sourceId}
					title={s.name}
					onclick={() => setSource(s.id)}
				>
					{#if s.thumbUrl}
						<img src={s.thumbUrl} alt="" />
					{:else}
						<span class="src-fallback">{s.name.slice(0, 2)}</span>
					{/if}
					{#if s.kind === 'video'}<span class="src-kind">VID</span>{/if}
				</button>
			{/each}
			{#if onAddSource}
				<button class="src-chip add" title="Add media" onclick={onAddSource}>
					<Plus size={14} />
				</button>
			{/if}
		</div>
		{#if !lane.sourceId}
			<p class="warn">Pick a source above — this layer has nothing to draw.</p>
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

		<h3 class="panel-title section">Layer effects</h3>
		<p class="hint">
			Run on this layer alone, before it meets the image. They are clipped to
			the layer's box.
		</p>
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
		/* Sits at the top of the sidebar, above the mosh settings: it takes the
		   leftover height and scrolls, they keep their natural one. */
		flex: 1;
		min-height: 0;
		overflow-y: auto;
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

	/* Full-bleed, matching the sidebar chain this panel replaces. */
	.clip-panel :global(aside.effects-panel) {
		flex: 0 0 auto;
		margin: 0 -0.75rem;
		width: auto;
		max-width: none;
	}

	.panel-head {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: 0.5rem;
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

	.src-grid {
		display: grid;
		grid-template-columns: repeat(auto-fill, minmax(52px, 1fr));
		gap: 4px;
	}

	.src-chip {
		position: relative;
		aspect-ratio: 1;
		padding: 0;
		border: 1px solid var(--line);
		border-radius: 4px;
		background: var(--ink);
		color: var(--text-3);
		cursor: pointer;
		overflow: hidden;
	}

	.src-chip img {
		width: 100%;
		height: 100%;
		object-fit: cover;
	}

	.src-chip:hover {
		border-color: var(--text-3);
	}

	.src-chip.active {
		border-color: var(--live);
		box-shadow: inset 0 0 0 1px var(--live);
	}

	.src-chip.add {
		display: flex;
		align-items: center;
		justify-content: center;
		border-style: dashed;
	}

	.src-fallback {
		font-size: 0.65rem;
		text-transform: uppercase;
	}

	.src-kind {
		position: absolute;
		right: 2px;
		bottom: 2px;
		padding: 0 2px;
		border-radius: 2px;
		background: rgba(0, 0, 0, 0.65);
		font-size: 0.5rem;
		letter-spacing: 0.06em;
		color: var(--text-2);
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
