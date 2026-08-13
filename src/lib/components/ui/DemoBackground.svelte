<script lang="ts">
	/**
	 * Live mosh running behind the upload screen — the app demoing itself rather
	 * than a video of it. Renders into the warm canvas App already keeps around
	 * for shader pre-compilation, so the demo costs no extra WebGL context and
	 * hands the same one straight to the editor when a file lands.
	 */
	import { Pause, Play } from "lucide-svelte";
	import type { GlRenderer } from "../../gl/renderer";
	import {
		DEFAULT_SETTINGS,
		loadSettings,
		updateSettings,
		type UploadMode,
	} from "../../editor/settings";
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

	// Deliberately not tied to prefers-reduced-motion: people set that flag for
	// their OS, not to opt out of a page's centrepiece. Own button, own memory.
	let playing = $state(
		loadSettings().demoBackground ?? DEFAULT_SETTINGS.demoBackground,
	);

	/** Set once the render loop is wired up, so the button can drive it without
	 * tearing down and reparenting the canvas on every toggle. */
	let transport = $state<{ start: () => void; stop: () => void } | null>(null);

	function togglePlaying() {
		playing = !playing;
		updateSettings({ demoBackground: playing });
	}

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
		// Accumulated rather than wall-clock, so a pause doesn't silently skip
		// the demo forward by however long it sat frozen.
		let elapsed = 0;
		let lastTs = 0;

		const drawFrame = () => {
			const now = performance.now();
			if (lastTs) elapsed += (now - lastTs) / 1000;
			lastTs = now;
			const t = elapsed;
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
			lastTs = 0;
		};
		const start = () => {
			if (!raf && !document.hidden) raf = requestAnimationFrame(loop);
		};
		const onVisibility = () =>
			document.hidden || !playing ? stop() : start();

		// A paused demo still shows a moshed still rather than a black hole —
		// preserveDrawingBuffer keeps the last frame on screen.
		drawFrame();
		document.addEventListener("visibilitychange", onVisibility);
		transport = { start, stop };

		return () => {
			stop();
			transport = null;
			document.removeEventListener("visibilitychange", onVisibility);
			// Park the canvas back where warmup left it, hidden — the editor
			// reparents this exact element and expects it still attached.
			canvas.style.cssText =
				"position:absolute;visibility:hidden;pointer-events:none";
			canvas.className = "";
			document.body.appendChild(canvas);
		};
	});

	$effect(() => {
		if (!transport) return;
		if (playing) transport.start();
		else transport.stop();
	});
</script>

<div class="demo-bg" class:live>
	<div class="demo-holder" bind:this={holder}></div>
	{#if !live && sources.length > 0}
		<img class="demo-poster" src={sources[0].src} alt="" />
	{/if}
	<div class="scrim"></div>
</div>

{#if transport}
	<button
		class="demo-toggle"
		onclick={togglePlaying}
		title={playing ? 'Freeze the background demo' : 'Resume the background demo'}
	>
		{#if playing}
			<Pause size={12} />
			FREEZE
		{:else}
			<Play size={12} />
			ANIMATE
		{/if}
	</button>
{/if}

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

	/* Bottom left, opposite the GitHub link. */
	.demo-toggle {
		position: fixed;
		bottom: 1rem;
		left: 1rem;
		z-index: 1;
		display: inline-flex;
		align-items: center;
		gap: 0.4rem;
		padding: 0.35rem 0.75rem;
		border: 1.5px solid rgba(255, 255, 255, 0.14);
		border-radius: 999px;
		background: rgba(10, 10, 12, 0.5);
		backdrop-filter: blur(16px);
		-webkit-backdrop-filter: blur(16px);
		color: #7d7d7d;
		font-family: inherit;
		font-size: 0.66rem;
		font-weight: 600;
		letter-spacing: 0.08em;
		cursor: pointer;
		transition:
			color 0.2s,
			border-color 0.2s;
	}

	.demo-toggle:hover {
		border-color: rgba(255, 255, 255, 0.32);
		color: #ccc;
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
