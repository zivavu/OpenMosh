<script lang="ts">
	/**
	 * Live mosh running behind the upload screen — the app demoing itself rather
	 * than a video of it. Renders into the warm canvas App already keeps around
	 * for shader pre-compilation, so the demo costs no extra WebGL context and
	 * hands the same one straight to the editor when a file lands.
	 */
	import type { GlRenderer } from "../../gl/renderer";
	import type { UploadMode } from "../../editor/settings";
	import { loadDemoSources } from "../../demo/demo-sources";
	import {
		createDemoDirector,
		missingDemoEffects,
	} from "../../demo/demo-director";

	interface Props {
		mode: UploadMode;
		warmCanvas: HTMLCanvasElement | null;
		warmRenderer: GlRenderer | null;
	}

	let { mode, warmCanvas, warmRenderer }: Props = $props();

	let holder = $state<HTMLDivElement>(undefined!);
	let sources = $state<HTMLImageElement[]>([]);
	let live = $state(false);

	const reducedMotion =
		typeof matchMedia === "function" &&
		matchMedia("(prefers-reduced-motion: reduce)").matches;

	$effect(() => {
		if (import.meta.env.DEV) {
			const missing = missingDemoEffects();
			if (missing.length > 0) {
				console.warn("Demo references unknown effects:", missing);
			}
		}
		let cancelled = false;
		void loadDemoSources().then((imgs) => {
			if (!cancelled) sources = imgs;
		});
		return () => {
			cancelled = true;
		};
	});

	$effect(() => {
		const renderer = warmRenderer;
		const canvas = warmCanvas;
		const imgs = sources;
		const currentMode = mode;
		if (!renderer || !canvas || imgs.length === 0 || !holder) return;

		canvas.style.cssText = "";
		canvas.className = "demo-canvas";
		holder.appendChild(canvas);

		const director = createDemoDirector(currentMode, imgs.length);
		let shownIndex = -1;
		let raf = 0;
		const start = performance.now();

		const drawFrame = () => {
			const t = (performance.now() - start) / 1000;
			const frame = director.frameAt(t);
			if (frame.sourceIndex !== shownIndex) {
				const img = imgs[frame.sourceIndex];
				// First upload allocates the texture and FBOs; later cuts only
				// swap pixels, since every poster shares one size.
				if (shownIndex === -1) renderer.loadImage(img);
				else renderer.updateSourceImage(img);
				shownIndex = frame.sourceIndex;
			}
			renderer.render(frame.effects, t);
			live = true;
		};

		const loop = () => {
			drawFrame();
			raf = requestAnimationFrame(loop);
		};

		const stop = () => {
			if (raf) cancelAnimationFrame(raf);
			raf = 0;
		};
		const resume = () => {
			if (!raf && !document.hidden) raf = requestAnimationFrame(loop);
		};
		const onVisibility = () => (document.hidden ? stop() : resume());

		if (reducedMotion) {
			// One moshed still: the look without the motion.
			drawFrame();
		} else {
			document.addEventListener("visibilitychange", onVisibility);
			resume();
		}

		return () => {
			stop();
			document.removeEventListener("visibilitychange", onVisibility);
			// Park the canvas back where warmup left it, hidden — the editor
			// reparents this exact element and expects it still attached.
			canvas.style.cssText =
				"position:absolute;visibility:hidden;pointer-events:none";
			canvas.className = "";
			document.body.appendChild(canvas);
		};
	});
</script>

<div class="demo-bg" class:live>
	<div class="demo-holder" bind:this={holder}></div>
	{#if !live && sources.length > 0}
		<img class="demo-poster" src={sources[0].src} alt="" />
	{/if}
	<div class="scrim"></div>
</div>

<style>
	.demo-bg {
		position: fixed;
		inset: 0;
		z-index: 0;
		overflow: hidden;
		pointer-events: none;
		background: #000;
	}

	.demo-holder {
		position: absolute;
		inset: 0;
		opacity: 0;
		transition: opacity 0.8s ease;
	}

	.live .demo-holder {
		opacity: 1;
	}

	.demo-holder :global(.demo-canvas),
	.demo-poster {
		position: absolute;
		inset: 0;
		width: 100%;
		height: 100%;
		object-fit: cover;
	}

	.demo-poster {
		opacity: 0.5;
	}

	/* The upload UI has to stay readable over whatever the mosh throws up:
	   a heavy centre-weighted scrim, not a flat dim, so the corners keep some
	   of the motion. */
	.scrim {
		position: absolute;
		inset: 0;
		background:
			radial-gradient(
				ellipse 70% 60% at 50% 45%,
				rgba(0, 0, 0, 0.92) 0%,
				rgba(0, 0, 0, 0.78) 45%,
				rgba(0, 0, 0, 0.6) 100%
			),
			linear-gradient(rgba(8, 8, 10, 0.55), rgba(8, 8, 10, 0.55));
	}
</style>
