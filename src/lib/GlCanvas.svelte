<script lang="ts">
  import { GlRenderer } from './gl/renderer';
  import type { EffectInstance } from './effects';

  interface Props {
    imageSrc: string;
    effects: EffectInstance[];
  }

  let { imageSrc, effects }: Props = $props();

  let canvas = $state<HTMLCanvasElement>(null!);
  let renderer: GlRenderer | null = $state(null);
  let imageReady = $state(false);
  let error: string | null = $state(null);

  $effect(() => {
    try {
      renderer = new GlRenderer(canvas);
    } catch (e) {
      error = e instanceof Error ? e.message : 'Failed to initialize WebGL2';
    }
    return () => {
      renderer?.destroy();
      renderer = null;
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
      imageReady = true;
    };
    img.src = imageSrc;
    return () => {
      cancelled = true;
    };
  });

  $effect(() => {
    if (!renderer || !imageReady) return;
    renderer.render(effects);
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
