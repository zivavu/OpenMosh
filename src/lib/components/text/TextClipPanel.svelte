<script lang="ts">
	import Checkbox from "../ui/Checkbox.svelte";
	import { OPAQUE_OUTPUT_EFFECTS } from "../../gl/effect-shaders";
	import { ensureFontLoaded } from "../../text-overlay";
	import {
		DEFAULT_TEXT_STYLE,
		type TextAlign,
		type TextClip,
		type TextLane,
		type TextStyle,
	} from "../../text";
	import type { SpectrumData } from "../../types";
	import type { AudioResponse } from "../../audio/auto-range";
	import ColorPicker from "../ui/ColorPicker.svelte";
	import FontSelect from "../ui/FontSelect.svelte";
	import FontCycleRows from "./FontCycleRows.svelte";
	import RangeSlider from "../ui/RangeSlider.svelte";
	import ClipChainSection from "../timeline/ClipChainSection.svelte";
	import ClipPanel from "../timeline/ClipPanel.svelte";
	import FadeRows from "../timeline/FadeRows.svelte";
	import LayerCompositeRows from "../timeline/LayerCompositeRows.svelte";

	interface Props {
		lane: TextLane | null;
		clip: TextClip | null;
		onLaneChange: (lane: TextLane) => void;
		onClipChange: (clip: TextClip) => void;
		onBeforeEdit?: (coalesceKey?: string) => void;
		/** Deselects the clip, which puts the image effects back in the sidebar. */
		onClose?: () => void;
		hasTrack?: boolean;
		spectrumData?: SpectrumData | null;
		response?: AudioResponse;
		/** Which half to show: the clip's controls, or the lane's effect chain. */
		section?: "clip" | "chain";
		/** For the font-on-beat rows to say when there's no tempo to follow. */
		bpm?: number;
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
		section = "clip",
		bpm,
	}: Props = $props();

	function setUnderEffects(under: boolean) {
		if (!lane) return;
		onBeforeEdit?.();
		onLaneChange({ ...lane, underEffects: under });
	}

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
	 * Double-clicking a row puts that style back to the default. Bound on the row
	 * rather than the control so it also reaches a native select, whose popup
	 * swallows the second click. Text fields and the open colour picker are left
	 * alone.
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

	/** Zero means no ramp at all, which the clip carries as an absent field. */
	function setFade(edge: "fadeInSec" | "fadeOutSec", sec: number) {
		if (!clip) return;
		onBeforeEdit?.(`tc-${edge}-${clip.id}`);
		onClipChange({ ...clip, [edge]: sec > 0 ? sec : undefined });
	}

	let opaqueNames = $derived(
		(clip?.effects ?? [])
			.filter((e) => e.enabled && OPAQUE_OUTPUT_EFFECTS.has(e.defId))
			.map((e) => e.defId),
	);
</script>

<ClipPanel
	open={!!clip && !!lane}
	emptyText="Select a text clip to edit it."
	{section}
	title={lane?.name ?? ""}
	{onClose}
	closeLabel="Close text clip"
>
	{#snippet controls()}
		{#if clip && lane}
			<textarea
				class="text-input"
				placeholder="Type the text for this clip"
				value={clip.text}
				oninput={(e) => setText((e.currentTarget as HTMLTextAreaElement).value)}
			></textarea>

			<FadeRows {clip} noun="this text" idPrefix="tc" onFade={setFade} />

			<!-- svelte-ignore a11y_no_static_element_interactions -->
			<div
				class="row"
				title="Typeface this clip is drawn in. Double-click to reset."
				ondblclick={(e) => {
					void ensureFontLoaded(DEFAULT_TEXT_STYLE.fontFamily);
					resetStyle(e, "fontFamily");
				}}
			>
				<label for="tc-font">Font</label>
				<FontSelect
					id="tc-font"
					value={lane.style.fontFamily}
					onChange={(family) => setStyle("fontFamily", family)}
				/>
			</div>

			<FontCycleRows
				cycle={lane.style.fontCycle}
				fontFamily={lane.style.fontFamily}
				{bpm}
				text={clip.text}
				onChange={(cycle) => setStyle("fontCycle", cycle)}
			/>

			<!-- svelte-ignore a11y_no_static_element_interactions -->
			<div
				class="row"
				title="Height of the text as a share of the frame, so it holds at any export size. Double-click to reset."
				ondblclick={(e) => resetStyle(e, "size")}
			>
				<label for="tc-size">Size</label>
				<RangeSlider
					id="tc-size"
					value={lane.style.size}
					min={0.02}
					max={0.5}
					step={0.005}
					oninput={(v) => setStyle("size", v, `tc-size-${clip.id}`)}
				/>
				<span class="val">{Math.round(lane.style.size * 100)}%</span>
			</div>

			<!-- svelte-ignore a11y_no_static_element_interactions -->
			<div
				class="row"
				title="Which side of the position the text runs from. It also sets the edge several lines line up on. Double-click to reset."
				ondblclick={(e) => resetStyle(e, "align")}
			>
				<label for="tc-align">Align</label>
				<select
					id="tc-align"
					value={lane.style.align}
					onchange={(e) =>
						setStyle(
							"align",
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
				title="Where the text is anchored across the frame — 0 at the left edge, 100 at the right. Double-click to reset."
				ondblclick={(e) => resetStyle(e, "x")}
			>
				<label for="tc-x">Position X</label>
				<RangeSlider
					id="tc-x"
					value={lane.style.x}
					min={0}
					max={1}
					step={0.01}
					oninput={(v) => setStyle("x", v, `tc-x-${clip.id}`)}
				/>
				<span class="val">{Math.round(lane.style.x * 100)}</span>
			</div>

			<!-- svelte-ignore a11y_no_static_element_interactions -->
			<div
				class="row"
				title="Where the text is anchored down the frame — 0 at the top edge, 100 at the bottom. Double-click to reset."
				ondblclick={(e) => resetStyle(e, "y")}
			>
				<label for="tc-y">Position Y</label>
				<RangeSlider
					id="tc-y"
					value={lane.style.y}
					min={0}
					max={1}
					step={0.01}
					oninput={(v) => setStyle("y", v, `tc-y-${clip.id}`)}
				/>
				<span class="val">{Math.round(lane.style.y * 100)}</span>
			</div>

			<!-- svelte-ignore a11y_no_static_element_interactions -->
			<div
				class="row"
				title="Fill colour of the text. Double-click to reset."
				ondblclick={(e) => resetStyle(e, "color")}
			>
				<label for="tc-color">Color</label>
				<ColorPicker
					id="tc-color"
					value={lane.style.color}
					defaultValue="#ffffff"
					onChange={(hex) => setStyle("color", hex)}
				/>
			</div>

			<!-- svelte-ignore a11y_no_static_element_interactions -->
			<div
				class="row"
				title="Draw a stroke around each letter, which is what keeps text readable over a busy shot. Double-click to reset."
				ondblclick={(e) => resetStyle(e, "outline")}
			>
				<label for="tc-outline">Outline</label>
				<Checkbox
					id="tc-outline"
					checked={lane.style.outline}
					onchange={(e) =>
						setStyle("outline", (e.currentTarget as HTMLInputElement).checked)}
				/>
			</div>

			{#if lane.style.outline}
				<!-- svelte-ignore a11y_no_static_element_interactions -->
				<div
					class="row"
					title="Colour of the stroke. The most contrast with the fill gives the most readable text. Double-click to reset."
					ondblclick={(e) => resetStyle(e, "outlineColor")}
				>
					<label for="tc-outline-color">Outline color</label>
					<ColorPicker
						id="tc-outline-color"
						value={lane.style.outlineColor}
						defaultValue="#000000"
						onChange={(hex) => setStyle("outlineColor", hex)}
					/>
				</div>
				<!-- svelte-ignore a11y_no_static_element_interactions -->
				<div
					class="row"
					title="Thickness of the stroke, in pixels at 720p and scaled from there. Double-click to reset."
					ondblclick={(e) => resetStyle(e, "outlineWidth")}
				>
					<label for="tc-outline-w">Outline width</label>
					<RangeSlider
						id="tc-outline-w"
						value={lane.style.outlineWidth}
						min={0}
						max={8}
						step={0.5}
						oninput={(v) => setStyle("outlineWidth", v, `tc-ow-${clip.id}`)}
					/>
					<span class="val">{lane.style.outlineWidth}</span>
				</div>
			{/if}

			<LayerCompositeRows
				style={lane.style}
				underEffects={lane.underEffects}
				noun="the text"
				idPrefix="tc"
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
				hint="this clip's text"
			>
				{#if opaqueNames.length > 0}
					<p class="warn">
						{opaqueNames.join(", ")} paints its own background, so it fills the frame
						instead of following the letters.
					</p>
				{/if}
			</ClipChainSection>
		{/if}
	{/snippet}
</ClipPanel>

<style>
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

	.row :global(.font-select) {
		flex: 1;
		min-width: 0;
	}

	/* The font picker is its own component, so the row's select styling has to
	   reach across the boundary. */
	.row :global(.font-select select) {
		padding: 0.2rem 0.3rem;
		border-radius: 4px;
		background: var(--surface);
		color: var(--text);
		font-family: inherit;
		font-size: 0.75rem;
	}
</style>
