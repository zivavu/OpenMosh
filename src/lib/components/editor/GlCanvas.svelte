<script lang="ts">
	import type { EffectInstance } from '../../effects';
	import { ANIMATED_EFFECTS } from '../../gl/effect-shaders';
	import { fitPreviewSize, measureDisplaySize } from '../../gl/preview-size';
	import { GlRenderer } from '../../gl/renderer';
	import type { VideoPreviewPlayer } from '../../video-preview/preview-player.svelte';

	/** Active sequence transition descriptor. Progress is computed per rendered
	 * frame from `getTime()` so the blend stays smooth even when the editor's
	 * reactive clock ticks slower than the rAF loop. */
	export interface CanvasTransition {
		effectsA: EffectInstance[];
		type: string;
		seed: number;
		direction: number;
		density: number;
		/** Master-clock time where the blend starts. */
		startTime: number;
		durationSec: number;
		getTime: () => number;
	}

	interface Props {
		imageSrc: string;
		effects: EffectInstance[];
		canvasWidth?: number;
		canvasHeight?: number;
		canvasEl?: HTMLCanvasElement | null;
		glRenderer?: GlRenderer | null;
		naturalWidth?: number;
		naturalHeight?: number;
		fps?: number;
		showFps?: boolean;
		videoEl?: HTMLVideoElement | null;
		/** WebCodecs preview player; takes precedence over videoEl as frame source. */
		frameSource?: VideoPreviewPlayer | null;
		freezeAnimation?: boolean;
		/** Stops all preview rendering (e.g. while recording, when the recorder
		 * owns the shared renderer — interleaved renders corrupt per-effect
		 * feedback history and delta-time state). */
		suspended?: boolean;
		warmCanvas?: HTMLCanvasElement | null;
		warmRenderer?: GlRenderer | null;
		/** Sequence segment transition in progress; `effects` is the incoming chain. */
		transition?: CanvasTransition | null;
	}

	let {
		imageSrc,
		effects,
		canvasWidth = undefined,
		canvasHeight = undefined,
		canvasEl = $bindable(null),
		glRenderer = $bindable(null),
		naturalWidth = $bindable(undefined),
		naturalHeight = $bindable(undefined),
		fps = $bindable(0),
		showFps = false,
		videoEl = null,
		frameSource = null,
		freezeAnimation = false,
		suspended = false,
		warmCanvas = null,
		warmRenderer = null,
		transition = null,
	}: Props = $props();

	let frameTimes: number[] = [];
	let lastFpsUpdate = 0;

	function trackFps(now: number) {
		frameTimes.push(now);
		if (now - lastFpsUpdate < 400) return;
		lastFpsUpdate = now;
		const cutoff = now - 1000;
		frameTimes = frameTimes.filter((t) => t > cutoff);
		fps = frameTimes.length;
	}

	let previewArea = $state<HTMLDivElement>(null!);
	let canvas = $state<HTMLCanvasElement>(null!);
	let renderer: GlRenderer | null = $state(null);
	let imageReady = $state(false);
	let error: string | null = $state(null);

	// Displayed preview size in device pixels. The renderer runs at the output
	// aspect fitted into this box (never upscaled), so heavy chains aren't paid
	// at full source resolution while the canvas is CSS-scaled down anyway.
	// Export/save temporarily resize the renderer to the real output size.
	let displayW = $state(0);
	let displayH = $state(0);
	$effect(() => {
		const el = previewArea;
		if (!el) return;
		let timer: ReturnType<typeof setTimeout> | undefined;
		const measure = () => {
			const { width, height } = measureDisplaySize(el);
			displayW = width;
			displayH = height;
		};
		measure();
		// Debounced: each renderer resize reallocates every FBO, so tracking a
		// window drag-resize per event would thrash GPU memory.
		const ro = new ResizeObserver(() => {
			clearTimeout(timer);
			timer = setTimeout(measure, 150);
		});
		ro.observe(el);
		return () => {
			clearTimeout(timer);
			ro.disconnect();
		};
	});

	const renderSize = $derived(
		fitPreviewSize(canvasWidth, canvasHeight, displayW, displayH),
	);

	const needsAnimation = $derived(
		!freezeAnimation &&
			(!!videoEl ||
				!!frameSource ||
				!!transition ||
				effects.some((e) => e.enabled && ANIMATED_EFFECTS.has(e.defId))),
	);

	/** Render the current frame: transition blend when a segment boundary is
	 * being crossed, otherwise the plain effect chain. */
	function drawFrame(now: number) {
		const tr = transition;
		if (tr && tr.durationSec > 0) {
			const p = (tr.getTime() - tr.startTime) / tr.durationSec;
			if (p >= 0 && p < 1) {
				renderer!.renderTransition(
					tr.effectsA,
					effects,
					tr.type,
					p,
					tr.seed,
					tr.direction,
					tr.density,
					now,
				);
				return;
			}
		}
		renderer!.render(effects, now);
	}

	$effect(() => {
		try {
			let r: GlRenderer;
			let activeCanvas: HTMLCanvasElement;

			if (warmCanvas && warmRenderer) {
				// Move the pre-warmed canvas (currently hidden in <body>) into our preview area.
				warmCanvas.style.cssText =
					'max-width:100%;max-height:100%;border-radius:2px;box-shadow:0 4px 24px rgba(0,0,0,0.5)';
				previewArea.appendChild(warmCanvas);
				warmRenderer.adoptCanvas(warmCanvas);
				r = warmRenderer;
				activeCanvas = warmCanvas;
			} else {
				r = new GlRenderer(canvas);
				activeCanvas = canvas;
			}

			renderer = r;
			canvasEl = activeCanvas;
			glRenderer = r;

			// Mutable ref so cleanup always destroys whichever renderer is currently
			// live, even if it was rebuilt by onContextRestored below.
			const current = { renderer: r };

			const onContextLost = (ev: Event) => {
				// preventDefault() is required for the browser to attempt automatic
				// restoration; without it, webglcontextrestored never fires.
				ev.preventDefault();
				error =
					'WebGL context lost — attempting to recover automatically. If this persists, please reload the page.';
			};
			const onContextRestored = () => {
				const newRenderer = new GlRenderer(activeCanvas);
				current.renderer = newRenderer;
				renderer = newRenderer;
				canvasEl = activeCanvas;
				glRenderer = newRenderer;
				error = null;
			};
			activeCanvas.addEventListener('webglcontextlost', onContextLost);
			activeCanvas.addEventListener('webglcontextrestored', onContextRestored);

			return () => {
				activeCanvas.removeEventListener('webglcontextlost', onContextLost);
				activeCanvas.removeEventListener('webglcontextrestored', onContextRestored);
				current.renderer.destroy();
				renderer = null;
				canvasEl = null;
				glRenderer = null;
				if (warmCanvas && warmCanvas.parentNode === previewArea) {
					previewArea.removeChild(warmCanvas);
				}
			};
		} catch (e) {
			error = e instanceof Error ? e.message : 'Failed to initialize WebGL2';
		}
	});

	// Image loading — skipped when a video source is active
	$effect(() => {
		if (!renderer || videoEl || frameSource) return;
		imageReady = false;
		const img = new Image();
		let cancelled = false;
		img.onload = () => {
			if (cancelled) return;
			renderer!.loadImage(img);
			naturalWidth = img.naturalWidth;
			naturalHeight = img.naturalHeight;
			// The main resize/draw effect below applies the preview render size
			imageReady = true;
		};
		img.src = imageSrc;
		return () => {
			cancelled = true;
		};
	});

	// WebCodecs preview — dimensions are known upfront, no element to wait on
	$effect(() => {
		if (!renderer || !frameSource) return;
		renderer.initVideoSource(frameSource.width, frameSource.height);
		naturalWidth = frameSource.width;
		naturalHeight = frameSource.height;
		imageReady = true;
	});

	// Video loading — initialises the renderer once metadata is available
	$effect(() => {
		if (!renderer || !videoEl || frameSource) return;
		imageReady = false;
		const video = videoEl;

		function onReady() {
			renderer!.loadVideo(video);
			naturalWidth = video.videoWidth;
			naturalHeight = video.videoHeight;
			imageReady = true;
		}

		// Wait for an actual decoded frame with known dimensions. In Firefox,
		// loadedmetadata (readyState 1) can report videoWidth 0 for some files;
		// initializing then allocates a 0×0 texture, every draw fails, and the
		// preview appears frozen while the video plays on.
		const isReady = () => video.readyState >= 2 && video.videoWidth > 0;

		if (isReady()) {
			onReady();
			return;
		}
		const events = ['loadeddata', 'canplay', 'resize', 'timeupdate'];
		const tryReady = () => {
			if (!isReady()) return;
			for (const ev of events) video.removeEventListener(ev, tryReady);
			onReady();
		};
		for (const ev of events) video.addEventListener(ev, tryReady);
		return () => {
			for (const ev of events) video.removeEventListener(ev, tryReady);
		};
	});

	$effect(() => {
		if (suspended || !renderer || !imageReady || !renderSize) return;
		renderer.resize(renderSize.width, renderSize.height);
		if (videoEl) renderer.updateSourceFrame(videoEl);
		drawFrame(needsAnimation ? performance.now() / 1000 : 0);
	});

	$effect(() => {
		if (suspended || !renderer || !imageReady) return;

		if (!needsAnimation) {
			if (videoEl) renderer.updateSourceFrame(videoEl);
			drawFrame(0);
			return;
		}

		let rafId: number;
		const loop = () => {
			if (frameSource) {
				const frame = frameSource.takeFrame();
				if (frame) {
					renderer!.updateSourceFrame(frame);
					frame.close();
				}
			} else if (videoEl) {
				renderer!.updateSourceFrame(videoEl);
			}
			drawFrame(performance.now() / 1000);
			trackFps(performance.now());
			rafId = requestAnimationFrame(loop);
		};
		rafId = requestAnimationFrame(loop);

		return () => cancelAnimationFrame(rafId);
	});
</script>

<div class="preview-area" bind:this={previewArea}>
	{#if !warmCanvas}
		<canvas bind:this={canvas} aria-label="Effect preview canvas"></canvas>
	{/if}
	{#if error}
		<p class="error">{error}</p>
	{:else if showFps}
		<span class="fps-overlay">{fps} FPS</span>
	{/if}
</div>

<style>
	.preview-area {
		position: relative;
		flex: 1;
		min-height: 0;
		display: flex;
		align-items: center;
		justify-content: center;
		overflow: hidden;
		padding: 1.5rem;
		background: #0a0a0a;
	}

	canvas {
		max-width: 100%;
		max-height: 100%;
		border-radius: 2px;
		box-shadow: 0 4px 24px rgba(0, 0, 0, 0.5);
	}

	.error {
		position: absolute;
		inset: 0;
		display: flex;
		align-items: center;
		justify-content: center;
		text-align: center;
		padding: 0 1.5rem;
		color: #ff6b6b;
		font-size: 0.9rem;
		background: rgba(0, 0, 0, 0.55);
		z-index: 10;
	}

	.fps-overlay {
		position: absolute;
		top: 1.8rem;
		left: 1.8rem;
		background: rgba(0, 0, 0, 0.65);
		color: #0f0;
		font-size: 0.72rem;
		font-weight: 600;
		font-family: 'Consolas', 'Monaco', monospace;
		font-variant-numeric: tabular-nums;
		padding: 0.2rem 0.5rem;
		border-radius: 4px;
		pointer-events: none;
		z-index: 10;
		letter-spacing: 0.04em;
	}

	@media (max-width: 800px) {
		.preview-area {
			padding: 0.5rem;
		}
	}
</style>
