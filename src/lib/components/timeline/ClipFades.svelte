<script lang="ts">
	import type { FadeEdge } from "../../timeline/clips";

	const FADES = [0.1, 0.25, 0.5, 1, 2, 5, 10];

	/** A selection bar's fade in and fade out, each undefined when the selection disagrees. */
	interface Props {
		fadeInSec: number | undefined;
		fadeOutSec: number | undefined;
		onFade: (edge: FadeEdge, sec: number) => void;
	}

	let { fadeInSec, fadeOutSec, onFade }: Props = $props();

	/** The presets, plus a length set in the sidebar's slider so it still shows. */
	function optionsFor(value: number | undefined): number[] {
		if (value === undefined || value <= 0 || FADES.includes(value))
			return FADES;
		return [...FADES, value].sort((a, b) => a - b);
	}
</script>

<div class="tl-tool-sep"></div>
{#each [["Fade in", "fadeInSec", fadeInSec], ["Fade out", "fadeOutSec", fadeOutSec]] as const as [label, edge, value] (edge)}
	<span class="tl-tool-label">{label}</span>
	<select
		class="fade-select"
		aria-label={label}
		value={value === undefined ? "" : String(value)}
		onchange={(e) => {
			const v = e.currentTarget.value;
			if (v !== "") onFade(edge, Number(v));
		}}
	>
		{#if value === undefined}
			<option value="" disabled>—</option>
		{/if}
		<option value="0">none</option>
		{#each optionsFor(value) as sec}
			<option value={String(sec)}>{+sec.toFixed(2)}s</option>
		{/each}
	</select>
{/each}

<style>
	/* Fixed: sized to its options, it jumped as the sidebar's slider set lengths like "2.85s". */
	.fade-select {
		width: calc(5ch + 1.75rem);
		padding-block: 0.15rem;
		padding-left: 0.25rem;
		border-radius: 4px;
		background-color: var(--surface);
		color: var(--text-2);
		font-size: 0.65rem;
		font-family: inherit;
	}
</style>
