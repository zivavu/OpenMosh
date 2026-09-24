<script lang="ts">
	/** Marks where a clip's media starts over, inside the clip. */
	interface Props {
		clip: { start: number; end: number };
		/** Timeline times of the restarts. */
		times: number[];
		/** The clip's width on screen. */
		px: number;
	}

	let { clip, times, px }: Props = $props();

	/** Closer than this the marks read as a smear, not a count. */
	const MIN_GAP_PX = 4;

	let visible = $derived(px / (times.length + 1) >= MIN_GAP_PX);
	let length = $derived(clip.end - clip.start);
</script>

{#if visible && length > 0}
	{#each times as t (t)}
		<span
			class="clip-repeat"
			style="left: {((t - clip.start) / length) * 100}%"
			aria-hidden="true"
		></span>
	{/each}
{/if}

<style>
	/* A notch top and bottom joined by a faint line: a seam, not a cut.
	   Light with a dark halo so it reads over a waveform in the clip's own color. */
	.clip-repeat {
		--repeat-mark: var(--text);
		position: absolute;
		top: 0;
		bottom: 0;
		width: 0;
		border-left: 1px dashed var(--repeat-mark);
		opacity: 0.85;
		filter: drop-shadow(0 0 1px var(--ink));
		pointer-events: none;
	}

	.clip-repeat::before,
	.clip-repeat::after {
		content: "";
		position: absolute;
		left: -3px;
		border: 3px solid transparent;
	}

	.clip-repeat::before {
		top: 0;
		border-top-color: var(--repeat-mark);
	}

	.clip-repeat::after {
		bottom: 0;
		border-bottom-color: var(--repeat-mark);
	}
</style>
