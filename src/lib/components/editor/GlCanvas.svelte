<script lang="ts">
	import { Minimize } from 'lucide-svelte';
	import type { EffectInstance } from '../../effects';
	import { ANIMATED_EFFECTS } from '../../gl/effect-shaders';
	import { fitPreviewSize, measureDisplaySize } from '../../gl/preview-size';
	import { GlRenderer } from '../../gl/renderer';
	import { onFontsChanged } from '../../text-overlay';
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
		/** True when a parent component drives `renderer.render()` itself (e.g. the
		 * slideshow preview engine). Prevents this component's rAF and static
		 * redraw effects from rendering duplicate frames. */
		externallyDriven?: boolean;
		warmCanvas?: HTMLCanvasElement | null;
		warmRenderer?: GlRenderer | null;
		/** Sequence segment transition in progress; `effects` is the incoming chain. */
		transition?: CanvasTransition | null;
		/** Sequence multi-source: given the seconds elapsed since the last call,
		 * uploads the active segment's frame. Returning true means it owned the
		 * source texture, so the primary image/video upload is skipped. */
		sourceDriver?: ((dtSec: number) => boolean) | null;
		/** Changes whenever the driven source does, retriggering a paused redraw. */
		sourceKey?: string | null;
		/** True while the driven source needs a per-frame upload (a video). */
		sourceAnimating?: boolean;
		/** Two-way: set it to enter/leave fullscreen, and it follows Esc or any
		 * other way the browser drops out of it. */
		fullscreen?: boolean;
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
		externallyDriven = false,
		warmCanvas = null,
		warmRenderer = null,
		transition = null,
		sourceDriver = null,
		sourceKey = null,
		sourceAnimating = false,
		fullscreen = $bindable(false),
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

	// ── Fullscreen ───────────────────────────────────────────────────────────
	// The preview area is the element that goes fullscreen, so the existing
	// ResizeObserver above picks up the new box and the renderer follows —
	// `fitPreviewSize` still caps at the output resolution, so a small source
	// isn't suddenly rendered at monitor size.
	$effect(() => {
		const el = previewArea;
		if (!el) return;
		const onChange = () => {
			fullscreen = document.fullscreenElement === el;
		};
		document.addEventListener('fullscreenchange', onChange);
		return () => document.removeEventListener('fullscreenchange', onChange);
	});

	$effect(() => {
		const el = previewArea;
		if (!el) return;
		const isFs = document.fullscreenElement === el;
		if (fullscreen === isFs) return;
		if (fullscreen) {
			// iOS Safari has no element fullscreen at all, and a request that
			// wasn't user-initiated is rejected. Either way, snap the flag back
			// so the button never sits in a state the document isn't in.
			const req = el.requestFullscreen?.();
			if (req) req.catch(() => (fullscreen = false));
			else fullscreen = false;
		} else if (document.fullscreenElement === el) {
			void document.exitFullscreen?.();
		}
	});

	// The exit hint fades on its own; re-shown on each entry.
	let showFsHint = $state(false);
	$effect(() => {
		if (!fullscreen) {
			showFsHint = false;
			return;
		}
		showFsHint = true;
		const timer = setTimeout(() => (showFsHint = false), 2200);
		return () => clearTimeout(timer);
	});

	const videoPlaying = $derived(!!videoEl && !videoEl.paused);
	const hasAnimatedEffects = $derived(
		effects.some((e) => e.enabled && ANIMATED_EFFECTS.has(e.defId)),
	);
	const needsAnimation = $derived(
		!externallyDriven &&
			!freezeAnimation &&
			(!!frameSource ||
				!!transition ||
				videoPlaying ||
				sourceAnimating ||
				hasAnimatedEffects),
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
				// Move the pre-warmed canvas (currently hidden in <body>) into our
				// preview area. Styled by class, not inline: an inline rule would
				// outrank the :fullscreen overrides below.
				warmCanvas.style.cssText = '';
				warmCanvas.className = 'preview-canvas';
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
		let ready = false;

		function onReady() {
			if (ready) return;
			ready = true;
			renderer!.loadVideo(video);
			naturalWidth = video.videoWidth;
			naturalHeight = video.videoHeight;
			imageReady = true;
			renderer!.updateSourceFrame(video);
			drawFrame(0);
		}

		// Wait for an actual decoded frame with known dimensions. In Firefox,
		// loadedmetadata (readyState 1) can report videoWidth 0 for some files;
		// initializing then allocates a 0×0 texture, every draw fails, and the
		// preview appears frozen while the video plays on.
		const isReady = () => video.readyState >= 2 && video.videoWidth > 0;

		// While the animation loop is running it handles per-frame uploads.
		// When the video is paused we still need to redraw after a seek.
		const onTimeUpdate = () => {
			if (!ready || needsAnimation) return;
			renderer!.updateSourceFrame(video);
			drawFrame(0);
		};

		if (isReady()) {
			onReady();
			video.addEventListener('timeupdate', onTimeUpdate);
			return () => video.removeEventListener('timeupdate', onTimeUpdate);
		}
		const events = ['loadeddata', 'canplay', 'resize', 'timeupdate'];
		const tryReady = () => {
			if (!isReady()) return;
			for (const ev of events) video.removeEventListener(ev, tryReady);
			onReady();
		};
		for (const ev of events) video.addEventListener(ev, tryReady);
		video.addEventListener('timeupdate', onTimeUpdate);
		return () => {
			for (const ev of events) video.removeEventListener(ev, tryReady);
			video.removeEventListener('timeupdate', onTimeUpdate);
		};
	});

	// Resize the renderer when the preview box changes. The render itself is
	// handled by the animation loop while active; otherwise a static redraw is
	// triggered here. When externally driven, the parent owns all rendering.
	$effect(() => {
		if (suspended || !renderer || !imageReady || !renderSize) return;
		renderer.resize(renderSize.width, renderSize.height);
		if (!externallyDriven && !needsAnimation) drawFrame(0);
	});

	// Static redraw driver: subscribes to effect values and re-renders when the
	// animation loop is not running. Using a separate effect prevents double
	// renders during playback (the rAF loop already owns the frame).
	$effect(() => {
		if (suspended || !renderer || !imageReady || !renderSize) return;
		if (externallyDriven || needsAnimation) return;
		for (const e of effects) {
			e.enabled;
			for (const k of Object.keys(e.values)) e.values[k];
		}
		// A caption font that lands after the frame was drawn changes its glyphs.
		fontTick;
		// Scrubbing onto another sequence source while paused: re-upload before
		// drawing. sourceKey also ticks when a late video upload lands, which is
		// what gets that frame onto a paused canvas.
		sourceKey;
		// Same hand-back problem as the animation loop, minus the frameSource
		// case (which always keeps that loop running).
		if (!sourceDriver?.(0) && videoEl && !frameSource) {
			renderer.updateSourceFrame(videoEl);
		}
		drawFrame(0);
	});

	let fontTick = $state(0);
	$effect(() => onFontsChanged(() => fontTick++));

	$effect(() => {
		if (suspended || !renderer || !imageReady) return;
		if (!needsAnimation) return;

		let rafId: number;
		let lastVideoTime = -1;
		let lastLoopMs = performance.now();
		let driverOwned = false;
		const loop = () => {
			const nowMs = performance.now();
			// Clamped: a backgrounded tab would otherwise jump a video source
			// forward by the whole time the tab was hidden.
			const dt = Math.min(0.25, (nowMs - lastLoopMs) / 1000);
			lastLoopMs = nowMs;
			const owned = !!sourceDriver?.(dt);
			// The frame a sequence segment borrowed the source texture for is
			// still on it. Both primary paths below only upload when something
			// changed, so without forcing one here a paused preview would keep
			// showing the other segment's media after the playhead left it.
			const handedBack = driverOwned && !owned;
			driverOwned = owned;
			if (!owned) {
				if (frameSource) {
					const frame = frameSource.takeFrame();
					if (frame) {
						renderer!.updateSourceFrame(frame);
						frame.close();
					} else if (handedBack) {
						// The player only hands out newly-due frames; re-seeking to
						// where it already is makes the next tick produce one.
						frameSource.seek(frameSource.currentTime);
					}
				} else if (videoEl) {
					const t = videoEl.currentTime;
					if (handedBack || t !== lastVideoTime) {
						renderer!.updateSourceFrame(videoEl);
						lastVideoTime = t;
					}
				}
			}
			drawFrame(nowMs / 1000);
			trackFps(nowMs);
			rafId = requestAnimationFrame(loop);
		};
		rafId = requestAnimationFrame(loop);

		return () => cancelAnimationFrame(rafId);
	});
</script>

<div class="preview-area" bind:this={previewArea}>
	{#if !warmCanvas}
		<canvas
			bind:this={canvas}
			class="preview-canvas"
			aria-label="Effect preview canvas"
		></canvas>
	{/if}
	{#if error}
		<p class="error">{error}</p>
	{:else if showFps}
		<span class="fps-overlay">{fps} FPS</span>
	{/if}
	{#if fullscreen}
		<button
			class="fs-exit"
			title="Exit fullscreen (Esc)"
			onclick={() => (fullscreen = false)}
		>
			<Minimize size={16} />
		</button>
		{#if showFsHint}
			<span class="fs-hint">ESC TO EXIT · SPACE TO PLAY</span>
		{/if}
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

	/* :global — the pre-warmed canvas is moved in via the DOM, so it never gets
	   Svelte's scoping attribute. */
	.preview-area :global(.preview-canvas) {
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

	/* Fullscreen: drop the framing so the render fills the display. */
	.preview-area:fullscreen {
		padding: 0;
		background: #000;
	}

	/* Scale up to fill the screen on whichever axis runs out first, letterboxing
	   the other — object-fit: contain does this on a canvas, which max-width /
	   max-height alone can't (they cap, they never upscale). */
	.preview-area:fullscreen :global(.preview-canvas) {
		width: 100%;
		height: 100%;
		max-width: none;
		max-height: none;
		object-fit: contain;
		border-radius: 0;
		box-shadow: none;
	}

	.fs-exit {
		position: absolute;
		top: 1rem;
		right: 1rem;
		display: flex;
		align-items: center;
		justify-content: center;
		width: 34px;
		height: 34px;
		padding: 0;
		border: 1px solid rgba(255, 255, 255, 0.12);
		border-radius: 6px;
		background: rgba(0, 0, 0, 0.5);
		color: #bbb;
		cursor: pointer;
		opacity: 0;
		transition:
			opacity 0.2s,
			color 0.2s;
		z-index: 11;
	}

	/* Out of the way until the pointer moves — the point of fullscreen is to
	   see only the render. Focus-visible keeps it reachable by keyboard. */
	.preview-area:hover .fs-exit,
	.fs-exit:focus-visible {
		opacity: 1;
	}

	.fs-exit:hover {
		color: #fff;
		border-color: rgba(255, 255, 255, 0.3);
	}

	.fs-hint {
		position: absolute;
		bottom: 1.6rem;
		left: 50%;
		transform: translateX(-50%);
		padding: 0.35rem 0.8rem;
		border-radius: 999px;
		background: rgba(0, 0, 0, 0.6);
		color: #999;
		font-size: 0.66rem;
		font-family: 'Consolas', 'Monaco', monospace;
		letter-spacing: 0.1em;
		pointer-events: none;
		z-index: 11;
		animation: fs-hint-fade 2.2s ease-out forwards;
	}

	@keyframes fs-hint-fade {
		0%,
		60% {
			opacity: 1;
		}
		100% {
			opacity: 0;
		}
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
