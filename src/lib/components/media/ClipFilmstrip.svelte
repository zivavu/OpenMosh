<script lang="ts">
	import type { SequenceSource } from "../../editor/sequence-sources.svelte";
	import type { SourceEdit } from "../../media";
	import { cutAt } from "../../media/cut-list";
	import { clipSourceTime } from "../../media/resolve";
	import type { MediaClip } from "../../media/types";
	import { filmstripIndexAt } from "../../video/filmstrip";

	/** A video clip's frames, each tile showing what plays at its spot on the timeline.
	 * A slideshow's tiles show the slide on screen there. */
	interface Props {
		clip: MediaClip;
		src: SequenceSource;
		/** A slide's thumbnail, for a slideshow clip. */
		slideThumb?: (id: string) => string | null;
		edits: Record<string, SourceEdit>;
		durations: Record<string, number>;
		/** The timeline's scale, and the stretch of it on screen. */
		pxPerSec: number;
		viewStart: number;
		viewEnd: number;
		tilePx: number;
	}

	let {
		clip,
		src,
		slideThumb,
		edits,
		durations,
		pxPerSec,
		viewStart,
		viewEnd,
		tilePx,
	}: Props = $props();

	let length = $derived(clip.end - clip.start);
	let tileSec = $derived(pxPerSec > 0 ? tilePx / pxPerSec : length);

	/** Only the tiles on screen: zoomed in, a long clip would run to thousands. */
	let tiles = $derived.by(() => {
		if (!(length > 0) || !(tileSec > 0)) return [];
		const from = Math.max(0, Math.floor((viewStart - clip.start) / tileSec));
		const to = Math.min(
			Math.ceil(length / tileSec),
			Math.ceil((viewEnd - clip.start) / tileSec),
		);
		const frames = src.filmstrip;
		const out: { k: number; url: string | null }[] = [];
		for (let k = from; k < to; k++) {
			const time = clip.start + k * tileSec;
			const { sourceTime } = clipSourceTime(
				clip,
				src.id,
				time,
				edits,
				durations,
			);
			if (src.cutList) {
				const slide = cutAt(src.cutList, sourceTime).slideId;
				out.push({ k, url: slideThumb?.(slide) ?? src.thumbUrl });
				continue;
			}
			const frame =
				frames?.[filmstripIndexAt(sourceTime, frames.length, src.duration)];
			out.push({ k, url: frame ?? src.thumbUrl });
		}
		return out;
	});
</script>

<span class="filmstrip" aria-hidden="true">
	{#each tiles as tile (tile.k)}
		{#if tile.url}
			<span
				class="tile"
				style="left: {((tile.k * tileSec) / length) *
					100}%; width: {tilePx}px; background-image: url({tile.url})"
			></span>
		{/if}
	{/each}
</span>

<style>
	.filmstrip {
		position: absolute;
		inset: 0;
		overflow: hidden;
		opacity: 0.35;
		pointer-events: none;
	}

	.tile {
		position: absolute;
		top: 0;
		bottom: 0;
		background-size: cover;
		background-position: center;
	}
</style>
