<script lang="ts">
	import { SlidersHorizontal } from "lucide-svelte";
	import {
		clipSourceId,
		DEFAULT_MEDIA_STYLE,
		DEFAULT_SOURCE_EDIT,
		hasAnimation,
		isFullCrop,
		MEDIA_FIT_OPTIONS,
		sourceSpan,
		type MediaClip,
		type MediaLane,
		type MediaStyle,
		type SourceEdit,
	} from "../../media";
	import type { SequenceSource } from "../../editor/sequence-sources.svelte";
	import type { SpectrumData } from "../../types";
	import type { AudioResponse } from "../../audio/auto-range";
	import RangeSlider from "../ui/RangeSlider.svelte";
	import ClipChainSection from "../timeline/ClipChainSection.svelte";
	import ClipPanel from "../timeline/ClipPanel.svelte";
	import FadeRows from "../timeline/FadeRows.svelte";
	import LayerCompositeRows from "../timeline/LayerCompositeRows.svelte";
	import { lazy } from "../../lazy";

	// Same chunk the source rail opens; only fetched when an edit starts.
	const loadSourceEditor = lazy(() => import("../editor/SourceEditor.svelte"));

	interface Props {
		lane: MediaLane | null;
		clip: MediaClip | null;
		sources?: SequenceSource[];
		onLaneChange: (lane: MediaLane) => void;
		onClipChange: (clip: MediaClip) => void;
		onBeforeEdit?: (coalesceKey?: string) => void;
		/** Deselects the clip, which puts the image effects back in the sidebar. */
		onClose?: () => void;
		hasTrack?: boolean;
		spectrumData?: SpectrumData | null;
		response?: AudioResponse;
		/** Per-source edits, keyed by source id. Sparse: only edited media. */
		edits?: Record<string, SourceEdit>;
		onEditChange?: (sourceId: string, edit: SourceEdit) => void;
		/** Fired as the media edit modal opens and closes. The editor stops playback
		 * while it is up. */
		onEditingChange?: (open: boolean) => void;
		/** Which half to show: the clip's controls, or the lane's effect chain. */
		section?: "clip" | "chain";
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
		edits = {},
		onEditChange,
		onEditingChange,
		section = "clip",
	}: Props = $props();

	let editingSource = $state(false);

	// Report the modal's state up, so the editor can stop the preview behind it.
	$effect(() => onEditingChange?.(editingSource));

	/** Whether the media this clip draws is not what its file holds. */
	let sourceEdited = $derived.by(() => {
		const e = source ? edits[source.id] : undefined;
		return (
			!!e &&
			(e.chromaKey.enabled ||
				!isFullCrop(e.crop) ||
				!!e.mask ||
				!!e.span ||
				hasAnimation(e))
		);
	});

	let source = $derived(
		lane ? sources.find((s) => s.id === clipSourceId(lane, clip)) : undefined,
	);
	let laneSource = $derived(sources.find((s) => s.id === lane?.sourceId));

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

	function resetStyle(e: MouseEvent, key: keyof MediaStyle) {
		const t = e.target as HTMLElement | null;
		if (t?.closest('input[type="text"], textarea')) return;
		setStyle(key, DEFAULT_MEDIA_STYLE[key]);
	}

	/** Point this clip at its own media. The empty value hands it back to the lane,
	 * so a clip that never chose keeps following the lane's picker. */
	function setClipSource(id: string) {
		if (!clip || !lane) return;
		onBeforeEdit?.();
		onClipChange({
			...clip,
			sourceId: id && id !== lane.sourceId ? id : undefined,
		});
	}

	/** Zero means no ramp at all, which the clip carries as an absent field. */
	function setFade(edge: "fadeInSec" | "fadeOutSec", sec: number) {
		if (!clip) return;
		onBeforeEdit?.(`mc-${edge}-${clip.id}`);
		onClipChange({ ...clip, [edge]: sec > 0 ? sec : undefined });
	}

	function setSourceStart(v: number) {
		if (!clip) return;
		onBeforeEdit?.(`media-in-${clip.id}`);
		onClipChange({ ...clip, sourceStart: v });
	}
</script>

<ClipPanel
	open={!!clip && !!lane}
	emptyText="Select a layer clip to edit it."
	{section}
	title={lane?.name ?? ""}
	subtitle={source?.name}
	{onClose}
	closeLabel="Close layer clip"
>
	{#snippet controls()}
		{#if clip && lane}
			{#if sources.length > 0}
				<!-- svelte-ignore a11y_no_static_element_interactions -->
				<div
					class="row"
					title="What this clip shows. Every clip on the lane shares its placement and effects, so cutting the lane up is how one layer plays several images."
				>
					<label for="mc-source">Media</label>
					<select
						id="mc-source"
						value={clip.sourceId ?? ""}
						onchange={(e) =>
							setClipSource((e.currentTarget as HTMLSelectElement).value)}
					>
						<option value="">
							Lane default{laneSource ? ` — ${laneSource.name}` : ""}
						</option>
						{#each sources as s (s.id)}
							<option value={s.id}>{s.name}</option>
						{/each}
					</select>
					{#if source && onEditChange}
						<!-- The other way in is a small button on a rail thumb, nowhere near this decision. -->
						<button
							class="src-edit"
							class:on={sourceEdited}
							onclick={() => (editingSource = true)}
							title="Edit “{source.name}” — crop it, erase parts, remove its background. Applies everywhere this media is used."
							aria-label="Edit {source.name}"
						>
							<SlidersHorizontal size={11} />
						</button>
					{/if}
				</div>
			{/if}

			{#if !source}
				<p class="warn">
					This clip has nothing to draw — pick media above, or drag a thumb from
					the media rail onto it.
				</p>
			{/if}

			{#if source?.kind === "video" && source.duration > 0}
				{const span = sourceSpan(edits[source.id], source.duration)}
				<!-- Bounded by the trim: an in-point before it starts at the trim's start anyway. -->
				<!-- svelte-ignore a11y_no_static_element_interactions -->
				<div class="row" title="Where in the video this clip starts">
					<label for="mc-in">Start at</label>
					<RangeSlider
						id="mc-in"
						value={Math.min(Math.max(clip.sourceStart, span.start), span.end)}
						min={span.start}
						max={span.end}
						step={0.05}
						oninput={setSourceStart}
					/>
					<span class="val">{clip.sourceStart.toFixed(1)}s</span>
				</div>
			{/if}

			<FadeRows {clip} noun="this layer" idPrefix="mc" onFade={setFade} />

			<!-- svelte-ignore a11y_no_static_element_interactions -->
			<div
				class="row"
				title="How the media fills its layer. Contain keeps all of it in frame, cover fills the frame and crops what hangs over, stretch bends it to the frame's shape. Double-click to reset."
				ondblclick={(e) => resetStyle(e, "fit")}
			>
				<label for="mc-fit">Fit</label>
				<select
					id="mc-fit"
					value={lane.style.fit}
					onchange={(e) =>
						setStyle(
							"fit",
							(e.currentTarget as HTMLSelectElement).value as MediaStyle["fit"],
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
				title="Size of the media on top of whatever the fit gave it. 100% is the fitted size. Dragging a corner handle on the preview moves this. Double-click to reset."
				ondblclick={(e) => resetStyle(e, "scale")}
			>
				<label for="mc-scale">Scale</label>
				<RangeSlider
					id="mc-scale"
					value={lane.style.scale}
					min={0.05}
					max={3}
					step={0.01}
					oninput={(v) => setStyle("scale", v, `mc-scale-${lane.id}`)}
				/>
				<span class="val">{Math.round(lane.style.scale * 100)}%</span>
			</div>

			<!-- svelte-ignore a11y_no_static_element_interactions -->
			<div
				class="row"
				title="Stretch across, on top of the scale. Dragging a side handle on the preview moves this. Double-click to reset."
				ondblclick={(e) => resetStyle(e, "scaleX")}
			>
				<label for="mc-scale-x">Scale X</label>
				<RangeSlider
					id="mc-scale-x"
					value={lane.style.scaleX}
					min={0.05}
					max={3}
					step={0.01}
					oninput={(v) => setStyle("scaleX", v, `mc-scale-x-${lane.id}`)}
				/>
				<span class="val">{Math.round(lane.style.scaleX * 100)}%</span>
			</div>

			<!-- svelte-ignore a11y_no_static_element_interactions -->
			<div
				class="row"
				title="Stretch down, on top of the scale. Dragging a top or bottom handle on the preview moves this. Double-click to reset."
				ondblclick={(e) => resetStyle(e, "scaleY")}
			>
				<label for="mc-scale-y">Scale Y</label>
				<RangeSlider
					id="mc-scale-y"
					value={lane.style.scaleY}
					min={0.05}
					max={3}
					step={0.01}
					oninput={(v) => setStyle("scaleY", v, `mc-scale-y-${lane.id}`)}
				/>
				<span class="val">{Math.round(lane.style.scaleY * 100)}%</span>
			</div>

			<!-- svelte-ignore a11y_no_static_element_interactions -->
			<div
				class="row"
				title="Room around the media for its own effects to spread into, as a share of its size on each side. A blur or a glow otherwise stops dead at the media's edge. 100% gives it as much margin as the media itself, and renders the media at a third of the buffer — the sharpness is what buys the room. Double-click to reset."
				ondblclick={(e) => resetStyle(e, "bleed")}
			>
				<label for="mc-bleed">Bleed</label>
				<RangeSlider
					id="mc-bleed"
					value={lane.style.bleed}
					min={0}
					max={1}
					step={0.01}
					oninput={(v) => setStyle("bleed", v, `mc-bleed-${lane.id}`)}
				/>
				<span class="val">{Math.round(lane.style.bleed * 100)}%</span>
			</div>

			{#if lane.style.bleed > 0}
				<!-- Only with a margin to fade: at a bleed of 0 there is nothing between the edges. -->
				<!-- svelte-ignore a11y_no_static_element_interactions -->
				<div
					class="row"
					title="How much of the bleed margin fades out instead of ending in a hard edge. The room the effects spill into still stops somewhere, and a glow cut off there draws the rectangle the bleed was meant to hide. Never eats into the media itself. Double-click to reset."
					ondblclick={(e) => resetStyle(e, "bleedFade")}
				>
					<label for="mc-bleed-fade">Bleed fade</label>
					<RangeSlider
						id="mc-bleed-fade"
						value={lane.style.bleedFade}
						min={0}
						max={1}
						step={0.01}
						oninput={(v) => setStyle("bleedFade", v, `mc-bleedfade-${lane.id}`)}
					/>
					<span class="val">{Math.round(lane.style.bleedFade * 100)}%</span>
				</div>
			{/if}

			<!-- svelte-ignore a11y_no_static_element_interactions -->
			<div
				class="row"
				title="Where the layer's centre sits across the frame — 0 at the left edge, 100 at the right. Past either takes it off screen. Dragging the layer on the preview moves this too. Double-click to reset."
				ondblclick={(e) => resetStyle(e, "x")}
			>
				<label for="mc-x">Position X</label>
				<RangeSlider
					id="mc-x"
					value={lane.style.x}
					min={-0.5}
					max={1.5}
					step={0.005}
					oninput={(v) => setStyle("x", v, `mc-x-${lane.id}`)}
				/>
				<span class="val">{Math.round(lane.style.x * 100)}</span>
			</div>

			<!-- svelte-ignore a11y_no_static_element_interactions -->
			<div
				class="row"
				title="Where the layer's centre sits down the frame — 0 at the top edge, 100 at the bottom. Past either takes it off screen. Double-click to reset."
				ondblclick={(e) => resetStyle(e, "y")}
			>
				<label for="mc-y">Position Y</label>
				<RangeSlider
					id="mc-y"
					value={lane.style.y}
					min={-0.5}
					max={1.5}
					step={0.005}
					oninput={(v) => setStyle("y", v, `mc-y-${lane.id}`)}
				/>
				<span class="val">{Math.round(lane.style.y * 100)}</span>
			</div>

			<!-- svelte-ignore a11y_no_static_element_interactions -->
			<div
				class="row"
				title="Turns the layer around its own centre, in degrees. Double-click to reset."
				ondblclick={(e) => resetStyle(e, "rotation")}
			>
				<label for="mc-rot">Rotation</label>
				<RangeSlider
					id="mc-rot"
					value={lane.style.rotation}
					min={-180}
					max={180}
					step={1}
					oninput={(v) => setStyle("rotation", v, `mc-rot-${lane.id}`)}
				/>
				<span class="val">{Math.round(lane.style.rotation)}°</span>
			</div>

			<LayerCompositeRows
				style={lane.style}
				underEffects={lane.underEffects}
				noun="the layer"
				idPrefix="mc"
				onStyle={(key, value, coalesceKey) =>
					setStyle(key, value as never, coalesceKey)}
				onReset={resetStyle}
				onUnderEffects={setUnderEffects}
			/>
		{/if}
	{/snippet}

	{#snippet chain()}
		{#if clip}
			<ClipChainSection
				{clip}
				{onClipChange}
				{onBeforeEdit}
				{hasTrack}
				{spectrumData}
				{response}
				hint="this clip's media"
			/>
		{/if}
	{/snippet}
</ClipPanel>

{#if editingSource && source && onEditChange}
	{#await loadSourceEditor() then SourceEditor}
		<SourceEditor
			{source}
			edit={edits[source.id] ?? DEFAULT_SOURCE_EDIT}
			onChange={(edit) => onEditChange(source!.id, edit)}
			onClose={() => (editingSource = false)}
		/>
	{/await}
{/if}

<style>
	/* Lit when the media carries an edit, the way the rail's own button is. */
	.src-edit {
		display: inline-flex;
		align-items: center;
		justify-content: center;
		flex-shrink: 0;
		width: 1.5rem;
		height: 1.5rem;
		border: 1px solid var(--line);
		border-radius: var(--r-1);
		background: var(--ink);
		color: var(--text-3);
		cursor: pointer;
	}

	.src-edit:hover {
		color: var(--text);
	}

	.src-edit.on {
		border-color: var(--live);
		color: var(--live);
	}
</style>
