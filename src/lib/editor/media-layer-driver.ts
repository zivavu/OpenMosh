import type { GlRenderer } from "../gl/renderer";
import type { ResolvedMediaLayer } from "../media";
import type { SequenceSourceRegistry } from "./sequence-sources.svelte";

export interface MediaLayerDriverOptions {
  registry: SequenceSourceRegistry;
  /** Read per call: the renderer is rebuilt on WebGL context loss. */
  getRenderer: () => GlRenderer | null;
  /** Called once a late upload lands, so a paused preview can redraw. */
  onUpload?: () => void;
}

/**
 * Uploads the frame each visible media layer wants, keyed by lane. The lane's
 * clip states where in its source it is, so what a layer shows at a given
 * master time never depends on how playback got there — and matches what the
 * export writes.
 *
 * Video layers get their own sampler even when they point at the primary
 * source: a layer runs on its own clip time, which is not where the editor's
 * player happens to be.
 */
export class MediaLayerDriver {
  #registry: SequenceSourceRegistry;
  #getRenderer: () => GlRenderer | null;
  #onUpload: (() => void) | undefined;

  /** Source whose frame is on each lane's texture, keyed by lane id. */
  #uploaded = new Map<string, string>();
  #disposed = false;

  constructor(opts: MediaLayerDriverOptions) {
    this.#registry = opts.registry;
    this.#getRenderer = opts.getRenderer;
    this.#onUpload = opts.onUpload;
  }

  advance(layers: ResolvedMediaLayer[]) {
    if (this.#disposed) return;
    for (const layer of layers) {
      const src = this.#registry.get(layer.sourceId);
      if (!src) {
        this.#release(layer.key);
        continue;
      }

      if (src.kind === "image") {
        // Still media only re-uploads when the lane's source changes; a photo
        // layer costs nothing per frame after the first.
        if (this.#uploaded.get(layer.key) === src.id) continue;
        const img = this.#registry.image(src.id);
        if (img?.complete) {
          this.#getRenderer()?.updateLayerImage(layer.key, img);
          this.#uploaded.set(layer.key, src.id);
        }
        continue;
      }

      const sampler = this.#registry.sampler(src.id);
      if (!sampler) continue;
      this.#uploaded.set(layer.key, src.id);
      void sampler.at(layer.sourceTime).then((frame) => {
        if (!frame) return;
        if (!this.#disposed) {
          this.#getRenderer()?.updateLayerFrame(layer.key, frame);
          this.#onUpload?.();
        }
        frame.close();
      });
    }
    // Lanes that stopped asking for frames drop theirs; the renderer collects
    // the textures on its own once they leave the resolved set.
    for (const key of this.#uploaded.keys()) {
      if (!layers.some((l) => l.key === key)) this.#uploaded.delete(key);
    }
  }

  #release(key: string) {
    if (!this.#uploaded.delete(key)) return;
    this.#getRenderer()?.dropLayerTexture(key);
  }

  /** Force the next call to re-upload, e.g. after the renderer was rebuilt. */
  invalidate() {
    this.#uploaded.clear();
  }

  dispose() {
    this.#disposed = true;
  }
}
