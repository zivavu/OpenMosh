<script lang="ts">
	import { getTimelineStack } from "../../editor/timeline-stack.svelte";
	import type { MixSegment } from "../../mix/plan";
	import { PEAKS_PER_SEC } from "../../mix/source-audio.svelte";
	import { clipFadeWeight } from "../../timeline/clips";

	/** A lane's sound drawn across the visible window, one canvas per lane: clips
	 * zoomed wide would otherwise each want a canvas thousands of pixels across. */
	interface Props {
		segments: MixSegment[];
		peaksOf: (sourceId: string) => Float32Array | null;
		/** Bumped as decodes land. */
		version: number;
		/** `strip` hugs the lane's foot, under a clip's picture; `full` fills it. */
		variant?: "full" | "strip";
	}

	let { segments, peaksOf, version, variant = "full" }: Props = $props();

	const vp = getTimelineStack().vp;
	let canvas = $state<HTMLCanvasElement | null>(null);
	let width = $state(0);
	let height = $state(0);

	$effect(() => {
		const el = canvas;
		if (!el) return;
		const observer = new ResizeObserver(() => {
			width = el.clientWidth;
			height = el.clientHeight;
		});
		observer.observe(el);
		return () => observer.disconnect();
	});

	$effect(() => {
		const el = canvas;
		const w = width;
		const h = height;
		const start = vp.viewStart;
		const span = vp.viewDuration;
		version;
		if (!el || w <= 0 || h <= 0 || span <= 0) return;
		const dpr = window.devicePixelRatio || 1;
		el.width = Math.round(w * dpr);
		el.height = Math.round(h * dpr);
		const g = el.getContext("2d");
		if (!g) return;
		g.setTransform(dpr, 0, 0, dpr, 0, 0);
		g.clearRect(0, 0, w, h);
		g.fillStyle = getComputedStyle(el).color;
		const sorted = [...segments].sort((a, b) => a.start - b.start);
		const perPx = span / w;
		let si = 0;
		for (let x = 0; x < w; x++) {
			const t = start + (x + 0.5) * perPx;
			while (si < sorted.length && sorted[si].end <= t) si++;
			const seg = sorted[si];
			if (!seg || seg.start > t) continue;
			const peaks = peaksOf(seg.sourceId);
			if (!peaks) continue;
			const src = seg.offset + (t - seg.start) * seg.rate;
			const i0 = Math.floor(src * PEAKS_PER_SEC);
			const i1 = Math.min(
				peaks.length,
				Math.max(i0 + 1, Math.floor((src + perPx * seg.rate) * PEAKS_PER_SEC)),
				i0 + 4000,
			);
			let peak = 0;
			for (let i = Math.max(0, i0); i < i1; i++) {
				if (peaks[i] > peak) peak = peaks[i];
			}
			const weight = clipFadeWeight(
				{ id: seg.clipId, start: seg.fade.start, end: seg.fade.end },
				seg.fade.fadeIn,
				seg.fade.fadeOut,
				t,
			);
			const amp = Math.min(1, peak * seg.gain * weight);
			if (amp <= 0) continue;
			const bar = Math.max(1, amp * h);
			g.fillRect(x, variant === "strip" ? h - bar : (h - bar) / 2, 1, bar);
		}
	});
</script>

<canvas bind:this={canvas} class="lane-wave {variant}" aria-hidden="true"
></canvas>

<style>
	/* Over the clips, so the sound reads through them; never in the way of a click. */
	.lane-wave {
		position: absolute;
		left: 0;
		width: 100%;
		pointer-events: none;
		color: var(--clip-fg);
		opacity: 0.55;
		z-index: 1;
	}

	.lane-wave.full {
		top: 2px;
		height: calc(100% - 4px);
	}

	.lane-wave.strip {
		bottom: 1px;
		height: 30%;
		opacity: 0.45;
	}
</style>
