<script lang="ts">
	import { SlidersHorizontal, X } from "lucide-svelte";
	import { LaneEffects } from "../../timeline/lane-effects.svelte";
	import {
		clipSourceId,
		DEFAULT_MEDIA_STYLE,
		DEFAULT_SOURCE_EDIT,
		hasAnimation,
		isFullCrop,
		MEDIA_FIT_OPTIONS,
		type MediaClip,
		type MediaLane,
		type MediaStyle,
		type SourceEdit,
	} from "../../media";
	import type { SequenceSource } from "../../editor/sequence-sources.svelte";
	import type { SpectrumData } from "../../types";
	import type { AudioResponse } from "../../audio/auto-range";
	import EffectsPanel from "../ui/EffectsPanel.svelte";
	import RangeSlider from "../ui/RangeSlider.svelte";
	import { lazy } from "../../lazy";

	// Same chunk the source rail opens; only fetched when an edit starts.
	const loadSourceEditor = lazy(() => import("../editor/SourceEditor.svelte"));

	const BLEND_MODES = [
		"normal",
		"multiply",
		"screen",
		"overlay",
		"add",
		"subtract",
		"difference",
		"exclusion",
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
		/** Per-source edits, keyed by source id. Sparse: only edited media. */
		edits?: Record<string, SourceEdit>;
		onEditChange?: (sourceId: string, edit: SourceEdit) => void;
		/** Fired as the media edit modal opens and closes. The editor stops
		 * playback while it is up: the modal has its own transport, and a clip
		 * running behind it fights the one being scrubbed inside. */
		onEditingChange?: (open: boolean) => void;
		/** Which half to show: the clip's controls, or the lane's effect chain.
		 * The sidebar gives each its own tab. */
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

	/** True while the media editor is open on this clip's source. */
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
				hasAnimation(e))
		);
	});

	/** What the selected clip draws: its own source, or the lane's. */
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

	/** Double-clicking a row puts that style back to the default. */
	function resetStyle(e: MouseEvent, key: keyof MediaStyle) {
		const t = e.target as HTMLElement | null;
		if (t?.closest('input[type="text"], textarea')) return;
		setStyle(key, DEFAULT_MEDIA_STYLE[key]);
	}

	/**
	 * Point this clip at its own media. The empty value hands it back to the
	 * lane, so a clip that never chose keeps following the lane's picker — the
	 * placement and the effect chain stay shared either way, which is the whole
	 * point of cutting a lane up rather than adding another.
	 */
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

	// The lane's chain, mirrored for EffectsPanel to own and written back on
	// every edit. Handled here rather than by the editor: the chain on show is
	// this mirror, so the editor has nothing to apply an edit to.
	const chain = new LaneEffects(
		() => lane,
		(next) => onLaneChange(next),
		(key) => onBeforeEdit?.(key),
	);
	$effect(() => chain.sync());
</script>

{#if !clip || !lane}
	<p class="empty">Select a layer clip to edit it.</p>
{:else}
	<div class="clip-panel">
		{#if section === "clip"}
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
						<!-- The other way in is a small button on a rail thumb, which is
					     nowhere near where the decision to crop something is made. -->
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

			<!-- Curved: the ramps worth reaching for are fractions of a second, and
		     a linear 0–10 track would bury all of them in its first pixels. -->
			<!-- svelte-ignore a11y_no_static_element_interactions -->
			<div
				class="row"
				title="Ramp this layer in from the clip's start. Double-click to clear."
				ondblclick={() => setFade("fadeInSec", 0)}
			>
				<label for="mc-fade-in">Fade in</label>
				<RangeSlider
					id="mc-fade-in"
					value={clip.fadeInSec ?? 0}
					min={0}
					max={10}
					step={0.05}
					curve={2}
					oninput={(v) => setFade("fadeInSec", v)}
				/>
				<span class="val">
					{#if clip.fadeInSec}{clip.fadeInSec.toFixed(2)}s{:else}none{/if}
				</span>
			</div>

			<!-- svelte-ignore a11y_no_static_element_interactions -->
			<div
				class="row"
				title="Ramp this layer out into the clip's end. Double-click to clear."
				ondblclick={() => setFade("fadeOutSec", 0)}
			>
				<label for="mc-fade-out">Fade out</label>
				<RangeSlider
					id="mc-fade-out"
					value={clip.fadeOutSec ?? 0}
					min={0}
					max={10}
					step={0.05}
					curve={2}
					oninput={(v) => setFade("fadeOutSec", v)}
				/>
				<span class="val">
					{#if clip.fadeOutSec}{clip.fadeOutSec.toFixed(2)}s{:else}none{/if}
				</span>
			</div>

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
				<!-- Only with a margin to fade: at a bleed of 0 there is nothing between
			     the media's edge and the layer's, so the control would do nothing. -->
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

			<!-- svelte-ignore a11y_no_static_element_interactions -->
			<div
				class="row"
				title="How much of the layer shows, against the layers under it. Double-click to reset."
				ondblclick={(e) => resetStyle(e, "opacity")}
			>
				<label for="mc-opacity">Opacity</label>
				<RangeSlider
					id="mc-opacity"
					value={lane.style.opacity}
					min={0}
					max={1}
					step={0.01}
					oninput={(v) => setStyle("opacity", v, `mc-op-${lane.id}`)}
				/>
				<span class="val">{Math.round(lane.style.opacity * 100)}%</span>
			</div>

			<!-- svelte-ignore a11y_no_static_element_interactions -->
			<div
				class="row"
				title="How this layer's colours mix with the ones underneath instead of simply covering them. Double-click to reset."
				ondblclick={(e) => resetStyle(e, "blendMode")}
			>
				<label for="mc-blend">Blend</label>
				<select
					id="mc-blend"
					value={lane.style.blendMode}
					onchange={(e) =>
						setStyle(
							"blendMode",
							(e.currentTarget as HTMLSelectElement)
								.value as MediaStyle["blendMode"],
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
				title="When on, the layer joins the frame before the image effects run, so they distort it too. When off, it's drawn over the finished frame and they leave it alone."
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
		{/if}

		{#if section === "chain"}
			<p class="hint">
				These effects only run on this layer's media, before it meets the base image.
			</p>
			<EffectsPanel
				headless
				bind:effects={() => chain.effects, (v) => (chain.effects = v)}
				{hasTrack}
				{spectrumData}
				{response}
				onVolumeLinkChange={(i, key, link) => chain.linkChange(i, key, link)}
				onUserEdit={() => chain.commit()}
				onEffectsReplaced={() => chain.commit()}
				onBeforeUserEdit={onBeforeEdit}
			/>
		{/if}
	</div>
{/if}

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
	/* Lit when the media carries an edit, the way the rail's own button is: the
	   panel should say the file is not what it was before you open anything. */
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
		width: 100%;
		max-width: var(--sidebar-w);
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
