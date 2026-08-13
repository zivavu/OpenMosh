<script lang="ts">
	/**
	 * Live mosh running behind the upload screen — the app demoing itself rather
	 * than a video of it. Renders into the warm canvas App already keeps around
	 * for shader pre-compilation, so the demo costs no extra WebGL context and
	 * hands the same one straight to the editor when a file lands.
	 */
	import { untrack } from "svelte";
	import { Play, Square } from "lucide-svelte";
	import type { GlRenderer } from "../../gl/renderer";
	import {
		DEFAULT_SETTINGS,
		loadSettings,
		updateSettings,
	} from "../../editor/settings";
	import { loadDemoSources } from "../../demo/demo-sources";
	import {
		getDemoDirector,
		missingDemoEffects,
	} from "../../demo/demo-director";

	interface Props {
		warmCanvas: HTMLCanvasElement | null;
		warmRenderer: GlRenderer | null;
	}

	let { warmCanvas, warmRenderer }: Props = $props();

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
		if (!renderer || !canvas || imgs.length === 0 || !holder) return;

		canvas.style.cssText = "";
		canvas.className = "demo-canvas";
		holder.appendChild(canvas);

		// Shared across modes and mounts, so the performance never restarts.
		const director = getDemoDirector(imgs.length);
		let shownIndex = -1;
		/** Poster currently staged in the renderer's outgoing slot. */
		let altIndex = -1;
		let raf = 0;
		// Fed a delta rather than wall-clock, so a pause doesn't silently skip
		// the demo forward by however long it sat frozen.
		let lastTs = 0;

		const drawFrame = () => {
			const now = performance.now();
			const dt = lastTs ? (now - lastTs) / 1000 : 0;
			lastTs = now;
			const frame = director.advance(dt);
			if (frame.sourceIndex !== shownIndex) {
				const img = imgs[frame.sourceIndex];
				// First upload allocates the texture and FBOs; later cuts only
				// swap pixels, since every poster shares one size.
				if (shownIndex === -1) renderer.loadImage(img);
				else renderer.updateSourceImage(img);
				shownIndex = frame.sourceIndex;
			}
			const t = frame.transition;
			if (t) {
				// The outgoing poster goes in the alt slot so the blend crosses
				// two different media, not just two effect chains.
				if (t.fromSourceIndex !== altIndex) {
					renderer.updateAltSourceImage(imgs[t.fromSourceIndex]);
					altIndex = t.fromSourceIndex;
				}
				renderer.renderTransition(
					t.effects,
					frame.effects,
					t.type,
					t.progress,
					t.seed,
					t.direction,
					t.density,
					frame.time,
					true,
				);
			} else {
				renderer.render(frame.effects, frame.time);
			}
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

		// Prime the canvas so the first painted frame isn't a fade-in from
		// nothing. Skipped when switched off, since off means a black screen
		// rather than a held still. Untracked: this draw runs inside the effect
		// body, so anything it touches would otherwise become a dependency and
		// re-trigger the whole setup.
		if (untrack(() => playing)) untrack(drawFrame);
		document.addEventListener("visibilitychange", onVisibility);
		transport = { start, stop };

		return () => {
			stop();
			transport = null;
			document.removeEventListener("visibilitychange", onVisibility);
			// The editor inherits this renderer; a poster left in the outgoing
			// slot would surface in its first sequence transition.
			renderer.clearAltSource();
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

<div class="demo-bg" class:live={live && playing} class:blank={!playing}>
	<div class="demo-holder" bind:this={holder}></div>
	{#if !live && playing && sources.length > 0}
		<img class="demo-poster" src={sources[0].src} alt="" />
	{/if}
	<div class="scrim"></div>
</div>

{#if transport}
	<button
		class="demo-toggle"
		onclick={togglePlaying}
		title={playing
			? 'Black out the background demo'
			: 'Resume the background demo'}
	>
		{#if playing}
			<Square size={12} />
			BLACK
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

	/* Switched off is the flat #121212 the upload screen had before the demo
	   existed — inherited from :root, no gradient, no scrim. */
	.demo-bg.blank {
		background: #121212;
	}

	/* The scrim only exists to keep the UI readable over the mosh; over the
	   blank grey it would just crush it back to black. */
	.blank .scrim {
		opacity: 0;
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

	/* Bottom left, opposite the GitHub link. Above the upload screen, which is
	   a full-viewport flex layer and would otherwise swallow the click. */
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

	/* The upload UI has to stay readable over whatever the mosh throws up:
	   a heavy centre-weighted scrim, not a flat dim, so the corners keep some
	   of the motion. */
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
