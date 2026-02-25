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
  }: Props = $props();

  let canvas = $state<HTMLCanvasElement>(null!);
  let renderer: GlRenderer | null = $state(null);
  let imageReady = $state(false);
  let error: string | null = $state(null);

  const needsAnimation = $derived(
    effects.some((e) => e.enabled && ANIMATED_EFFECTS.has(e.defId)),
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

  $effect(() => {
    if (!renderer) return;
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
    renderer.render(
      effects,
      needsAnimation ? performance.now() / 1000 : 0,
    );
  });

  $effect(() => {
    if (!renderer || !imageReady) return;

    if (!needsAnimation) {
      renderer.render(effects, 0);
      return;
    }

    let rafId: number;
    const loop = () => {
      renderer!.render(effects, performance.now() / 1000);
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
  {/if}
</div>

<style>
  .preview-area {
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
</style>
