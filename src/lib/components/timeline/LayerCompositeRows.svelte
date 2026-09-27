<script lang="ts">
	import { BLEND_MODES, type TextOverlayBlendMode } from "../../text-overlay";
	import RangeSlider from "../ui/RangeSlider.svelte";

	/** How a layer meets the frame: opacity and blend, the tail every layer
	 * kind's panel ends on. */
	interface Props {
		style: { opacity: number; blendMode: TextOverlayBlendMode };
		/** "the layer", "the text". */
		noun: string;
		idPrefix: string;
		onStyle: (
			key: "opacity" | "blendMode",
			value: number | TextOverlayBlendMode,
			coalesceKey?: string,
		) => void;
		onReset: (e: MouseEvent, key: "opacity" | "blendMode") => void;
	}

	let { style, noun, idPrefix, onStyle, onReset }: Props = $props();
</script>

<!-- svelte-ignore a11y_no_static_element_interactions -->
<div
	class="row"
	title="How much of {noun} shows, against what is under it. Double-click to reset."
	ondblclick={(e) => onReset(e, "opacity")}
>
	<label for="{idPrefix}-opacity">Opacity</label>
	<RangeSlider
		id="{idPrefix}-opacity"
		value={style.opacity}
		min={0}
		max={1}
		step={0.01}
		oninput={(v) => onStyle("opacity", v, `${idPrefix}-op`)}
	/>
	<span class="val">{Math.round(style.opacity * 100)}%</span>
</div>

<!-- svelte-ignore a11y_no_static_element_interactions -->
<div
	class="row"
	title="How {noun}'s colours mix with the layers underneath instead of simply covering them. Double-click to reset."
	ondblclick={(e) => onReset(e, "blendMode")}
>
	<label for="{idPrefix}-blend">Blend</label>
	<select
		id="{idPrefix}-blend"
		value={style.blendMode}
		onchange={(e) =>
			onStyle(
				"blendMode",
				(e.currentTarget as HTMLSelectElement).value as TextOverlayBlendMode,
			)}
	>
		{#each BLEND_MODES as mode (mode)}
			<option value={mode}>{mode}</option>
		{/each}
	</select>
</div>
