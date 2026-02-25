<script lang="ts">
  import { GlRenderer } from './gl/renderer';
  import { ANIMATED_EFFECTS } from './gl/effect-shaders';
  import type { EffectInstance } from './effects';

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

  let canvas = $state<HTMLCanvasElement>(null!);
  let renderer: GlRenderer | null = $state(null);
  let imageReady = $state(false);
  let error: string | null = $state(null);

  const needsAnimation = $derived(
    !!videoEl || effects.some((e) => e.enabled && ANIMATED_EFFECTS.has(e.defId)),
  );

  $effect(() => {
    try {
      const r = new GlRenderer(canvas);
      renderer = r;
      canvasEl = canvas;
      glRenderer = r;
    } catch (e) {
      error = e instanceof Error ? e.message : 'Failed to initialize WebGL2';
    }
    return () => {
      renderer?.destroy();
      renderer = null;
      canvasEl = null;
      glRenderer = null;
    };
  });

  // Image loading — skipped when a video source is active
  $effect(() => {
    if (!renderer || videoEl) return;
    imageReady = false;
    const img = new Image();
    let cancelled = false;
    img.onload = () => {
      if (cancelled) return;
      renderer!.loadImage(img);
      naturalWidth = img.naturalWidth;
      naturalHeight = img.naturalHeight;
      imageReady = true;
      if (
        canvasWidth != null &&
        canvasHeight != null &&
        (canvasWidth !== img.naturalWidth || canvasHeight !== img.naturalHeight)
      ) {
        renderer!.resize(canvasWidth, canvasHeight);
      }
    };
    img.src = imageSrc;
    return () => {
      cancelled = true;
    };
  });

  // Video loading — initialises the renderer once metadata is available
  $effect(() => {
    if (!renderer || !videoEl) return;
    imageReady = false;
    const video = videoEl;

    function onReady() {
      renderer!.loadVideo(video);
      naturalWidth = video.videoWidth;
      naturalHeight = video.videoHeight;
      imageReady = true;
      if (
        canvasWidth != null &&
        canvasHeight != null &&
        (canvasWidth !== video.videoWidth || canvasHeight !== video.videoHeight)
      ) {
        renderer!.resize(canvasWidth, canvasHeight);
      }
    }

    if (video.readyState >= 1) {
      onReady();
      return;
    }
    video.addEventListener('loadedmetadata', onReady, { once: true });
    return () => video.removeEventListener('loadedmetadata', onReady);
  });

  $effect(() => {
    if (
      !renderer ||
      !imageReady ||
      canvasWidth == null ||
      canvasHeight == null ||
      canvasWidth <= 0 ||
      canvasHeight <= 0
    )
      return;
    renderer.resize(canvasWidth, canvasHeight);
    if (videoEl) renderer.updateSourceFrame(videoEl);
    renderer.render(
      effects,
      needsAnimation ? performance.now() / 1000 : 0,
    );
  });

  $effect(() => {
    if (!renderer || !imageReady) return;

    if (!needsAnimation) {
      if (videoEl) renderer.updateSourceFrame(videoEl);
      renderer.render(effects, 0);
      return;
    }

    let rafId: number;
    const loop = () => {
      if (videoEl) renderer!.updateSourceFrame(videoEl);
      renderer!.render(effects, performance.now() / 1000);
      trackFps(performance.now());
      rafId = requestAnimationFrame(loop);
    };
    rafId = requestAnimationFrame(loop);

    return () => cancelAnimationFrame(rafId);
  });
</script>

<div class="preview-area">
  {#if error}
    <p class="error">{error}</p>
  {:else}
    <canvas bind:this={canvas}></canvas>
    {#if showFps}
      <span class="fps-overlay">{fps} FPS</span>
    {/if}
  {/if}
</div>

<style>
  .preview-area {
    position: relative;
    flex: 1;
    display: flex;
    align-items: center;
    justify-content: center;
    overflow: hidden;
    padding: 1.5rem;
  }

  canvas {
    max-width: 100%;
    max-height: 100%;
    border-radius: 2px;
    box-shadow: 0 4px 24px rgba(0, 0, 0, 0.5);
  }

  .error {
    color: #ff6b6b;
    font-size: 0.9rem;
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
</style>
