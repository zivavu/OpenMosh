<script lang="ts">
	import RangeSlider from "../ui/RangeSlider.svelte";

	/** Fade in / fade out for a layer clip, each edge on its own. */
	interface Props {
		clip: { fadeInSec?: number; fadeOutSec?: number };
		/** What ramps: "this layer", "this text". */
		noun: string;
		idPrefix: string;
		onFade: (edge: "fadeInSec" | "fadeOutSec", sec: number) => void;
	}

	let { clip, noun, idPrefix, onFade }: Props = $props();
</script>

<!-- Curved: the ramps worth reaching for are fractions of a second, and
     a linear 0–10 track would bury all of them in its first pixels. -->
<!-- svelte-ignore a11y_no_static_element_interactions -->
<div
	class="row"
	title="Ramp {noun} in from the clip's start. Double-click to clear."
	ondblclick={() => onFade("fadeInSec", 0)}
>
	<label for="{idPrefix}-fade-in">Fade in</label>
	<RangeSlider
		id="{idPrefix}-fade-in"
		value={clip.fadeInSec ?? 0}
		min={0}
		max={10}
		step={0.05}
		curve={2}
		oninput={(v) => onFade("fadeInSec", v)}
	/>
	<span class="val">
		{#if clip.fadeInSec}{clip.fadeInSec.toFixed(2)}s{:else}none{/if}
	</span>
</div>

<!-- svelte-ignore a11y_no_static_element_interactions -->
<div
	class="row"
	title="Ramp {noun} out into the clip's end. Double-click to clear."
	ondblclick={() => onFade("fadeOutSec", 0)}
>
	<label for="{idPrefix}-fade-out">Fade out</label>
	<RangeSlider
		id="{idPrefix}-fade-out"
		value={clip.fadeOutSec ?? 0}
		min={0}
		max={10}
		step={0.05}
		curve={2}
		oninput={(v) => onFade("fadeOutSec", v)}
	/>
	<span class="val">
		{#if clip.fadeOutSec}{clip.fadeOutSec.toFixed(2)}s{:else}none{/if}
	</span>
</div>
