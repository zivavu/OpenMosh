<script lang="ts">
	/** Live mosh running behind the upload screen, rendering into the warm canvas App
	 * keeps for shader pre-compilation, so the demo costs no extra WebGL context. */
	import { untrack } from "svelte";
	import { Play, Square } from "lucide-svelte";
	import { GlRenderer } from "../../gl/renderer";
	import { demoBackgroundEnabled, updateSettings } from "../../editor/settings";
	import { DEMO_HEIGHT, DEMO_WIDTH } from "../../demo/demo-worlds";
	import {
		getDemoDirector,
		missingDemoEffects,
	} from "../../demo/demo-director";
	import {
		createFpsProbe,
		demoStartsFlat,
		rememberDemoSlow,
	} from "../../demo/demo-quality";

	interface Props {
		warmCanvas: HTMLCanvasElement | null;
		warmRenderer: GlRenderer | null;
		/** Bound so the STOP button can also quiet things outside the demo. */
		playing?: boolean;
	}

	let {
		warmCanvas,
		warmRenderer,
		playing = $bindable(demoBackgroundEnabled()),
	}: Props = $props();

	let holder = $state<HTMLDivElement>(undefined!);

	/** Seconds the demo takes to come up from black on its first frames. */
	const FADE_SECONDS = 1.2;
	const easeOut = (p: number) => 1 - (1 - p) ** 3;

	/** Set once the render loop is wired up, so the button can drive it without
	 * reparenting the canvas on every toggle. */
	let transport = $state<{
		start: () => void;
		stop: () => void;
		blank: () => void;
	} | null>(null);

	function togglePlaying() {
		playing = !playing;
		updateSettings({ demoBackground: playing });
	}

	$effect(() => {
		if (!import.meta.env.DEV) return;
		const missing = missingDemoEffects();
		if (missing.length > 0) {
			console.warn("Demo references unknown effects:", missing);
		}
	});

	$effect(() => {
		const renderer = warmRenderer;
		const canvas = warmCanvas;
		if (!renderer || !canvas || !holder) return;

		canvas.style.cssText = "";
		canvas.className = "demo-canvas";
		holder.appendChild(canvas);
		renderer.initBlankSource(DEMO_WIDTH, DEMO_HEIGHT);

		// Shared across modes and mounts, so the performance never restarts.
		const director = getDemoDirector(demoStartsFlat());
		/** Layer keys the worlds staged, released when the demo hands the renderer on. */
		const staged = new Set<string>();
		let raf = 0;
		// Fed a delta rather than wall-clock, so a pause doesn't silently skip the
		// demo forward by however long it sat frozen.
		let lastTs = 0;
		/** Seconds of drawn demo so far, capped at FADE_SECONDS. */
		let fadeT = 0;

		// Driven off the render loop rather than a CSS transition: the fade has to start
		// from a frame that was actually painted. The ramp only advances on drawn frames.
		const advanceFade = (dt: number) => {
			if (fadeT >= FADE_SECONDS) return;
			fadeT = Math.min(FADE_SECONDS, fadeT + dt);
			holder.style.opacity = String(easeOut(fadeT / FADE_SECONDS));
		};

		// Where a compile blocks the page (Firefox), any compile mid-show freezes the
		// world, so every world compiles before the first frame, one a frame.
		const unbuilt = renderer.scenesCompileInBackground ? [] : director.scenes();
		// Too slow for the 3D worlds, the demo cuts to the flat ones for good.
		let probe = director.flat ? null : createFpsProbe();
		const checkPace = (dt: number) => {
			const verdict = probe?.frame(dt);
			if (!verdict) return;
			probe = null;
			if (verdict === "smooth") return;
			director.goFlat();
			rememberDemoSlow();
			if (!renderer.scenesCompileInBackground)
				unbuilt.push(...director.scenes());
		};

		const drawFrame = () => {
			if (unbuilt.length > 0) {
				renderer.sceneReady(unbuilt.pop()!);
				return;
			}
			const now = performance.now();
			const dt = lastTs ? (now - lastTs) / 1000 : 0;
			lastTs = now;
			// Held while the world on screen still compiles, so it isn't cut short.
			const scene = director.scene();
			renderer.prepareScene(scene);
			if (!renderer.sceneReady(scene)) return;
			const frame = director.advance(dt);
			if (frame.upcoming) renderer.prepareScene(frame.upcoming);
			for (const p of frame.parts) {
				renderer.updateLayerScene(p.key, p.scene, p.part);
				staged.add(p.key);
			}
			renderer.render([], frame.time, [], frame.post, frame.layers);
			// dt is 0 on the first frame after any start, so the priming draw paints
			// the holder at opacity 0 before the ramp moves at all.
			advanceFade(dt);
			checkPace(dt);
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
		// Stopping is a blackout, not a pause, so it cuts and re-fades on resume.
		// A tab left in the background only calls stop().
		const blank = () => {
			fadeT = 0;
			holder.style.opacity = "0";
		};
		const onVisibility = () => (document.hidden || !playing ? stop() : start());

		// Prime the canvas so the first painted frame isn't a fade-in from nothing.
		// Untracked: anything this draw touches would re-trigger the whole setup.
		if (untrack(() => playing)) untrack(drawFrame);
		document.addEventListener("visibilitychange", onVisibility);
		transport = { start, stop, blank };

		return () => {
			stop();
			transport = null;
			document.removeEventListener("visibilitychange", onVisibility);
			for (const key of staged) renderer.dropLayerTexture(key);
			renderer.releaseScenes();
			// Park the canvas back where warmup left it, hidden: the editor reparents this
			// exact element and expects it attached.
			canvas.style.cssText = GlRenderer.PARKED_CANVAS_STYLE;
			canvas.className = "";
			document.body.appendChild(canvas);
		};
	});

	$effect(() => {
		if (!transport) return;
		if (playing) {
			transport.start();
		} else {
			transport.stop();
			transport.blank();
		}
	});
</script>

<div class="demo-bg" class:blank={!playing}>
	<div class="demo-holder" bind:this={holder}></div>
	<div class="scrim"></div>
</div>

{#if transport}
	<button
		class="demo-toggle"
		onclick={togglePlaying}
		title={playing
			? "Black out the background demo"
			: "Resume the background demo"}
	>
		{#if playing}
			<Square size={12} />
			STOP
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

	/* Switched off is the flat #121212 the upload screen had before the demo existed. */
	.demo-bg.blank {
		background: #121212;
	}

	/* The scrim only exists to keep the UI readable over the mosh; over the blank
	   grey it would just crush it back to black. */
	.blank .scrim {
		opacity: 0;
	}

	/* Starts black and comes up into the mosh: the first frame is a whole image
	   appearing at once, so a hard cut reads as a flash. The ramp itself is an
	   inline opacity written by the render loop. */
	.demo-holder {
		position: absolute;
		inset: 0;
		opacity: 0;
	}

	.demo-holder :global(.demo-canvas) {
		position: absolute;
		inset: 0;
		width: 100%;
		height: 100%;
		object-fit: cover;
	}

	/* Bottom left, opposite the GitHub link. Above the upload screen, which would
	   otherwise swallow the click. */
	.demo-toggle {
		position: fixed;
		bottom: 1rem;
		left: 1rem;
		z-index: 2;
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

	/* The upload UI has to stay readable over whatever the mosh throws up: a
	   heavy centre-weighted scrim, not a flat dim. */
	.scrim {
		position: absolute;
		inset: 0;
		transition: opacity 0.5s ease;
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
