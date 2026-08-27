import type { GlRenderer } from "../gl/renderer";
import type { ResolvedMediaLayer } from "../media";
import { SlideVideoSampler } from "../slideshow/video-sampler";
import type { SequenceSource } from "./sequence-sources.svelte";

/**
 * Export-side twin of `MediaLayerDriver`. Same job — upload the frame each
 * visible layer wants — but every upload is awaited, so the recorder writes the
 * exact frame rather than whatever the decoder happened to have ready.
 *
 * Samplers are created here rather than borrowed from the preview registry: the
 * preview's are parked wherever the user last scrubbed, and an export must not
 * depend on that.
 */
export interface MediaExportLayers {
  /** Upload every layer in this frame's set. */
  advance(layers: ResolvedMediaLayer[]): Promise<void>;
  dispose(): void;
}

export async function createMediaExportLayers(
  sources: SequenceSource[],
  /** The source each lane draws from, keyed by lane id. */
  laneSources: Map<string, string>,
  renderer: GlRenderer,
): Promise<MediaExportLayers> {
  const byId = new Map(sources.map((s) => [s.id, s]));

  const images = new Map<string, HTMLImageElement>();
  /** One decoder per video *lane*: a sampler decodes sequentially from wherever
   * it is, so two lanes on one video have to hold one each. */
  const samplers = new Map<string, SlideVideoSampler>();
  /** Source whose frame is on each lane's texture, keyed by lane. */
  const uploaded = new Map<string, string>();

  // Opened up front — creating a decoder mid-export would stall the frame it
  // happens on. Layer media is a handful of files at most, unlike the sequence
  // pool, so the images are decoded here too.
  await Promise.all(
    [...laneSources].map(async ([laneId, sourceId]) => {
      const src = byId.get(sourceId);
      if (!src) return;
      if (src.kind === "video") {
        const sampler = await SlideVideoSampler.create(src.file);
        if (sampler) samplers.set(laneId, sampler);
        return;
      }
      if (images.has(src.id)) return;
      const img = await decodeImage(src.objectUrl);
      if (img) images.set(src.id, img);
    }),
  );

  return {
    async advance(layers) {
      // Run the lanes together rather than one after another. Each holds its
      // own decoder and writes its own texture, so nothing here is ordered —
      // and awaiting them in series made an exported frame cost the sum of
      // every lane's decode instead of the slowest one.
      await Promise.all(
        layers.map(async (layer) => {
          const src = byId.get(layer.sourceId);
          if (!src) return;

          if (src.kind === "image") {
            // Same as the preview driver: the renderer collects a lane's
            // texture whenever the lane stops resolving, so the latch alone
            // would skip the re-upload after a gap between clips.
            if (
              uploaded.get(layer.key) === src.id &&
              renderer.hasLayerTexture(layer.key)
            ) {
              return;
            }
            const img = images.get(src.id);
            if (!img) return;
            renderer.updateLayerImage(layer.key, img);
            uploaded.set(layer.key, src.id);
            return;
          }

          const sampler = samplers.get(layer.key);
          if (!sampler) return;
          uploaded.set(layer.key, src.id);
          const frame = await sampler.at(layer.sourceTime);
          if (frame) {
            renderer.updateLayerFrame(layer.key, frame);
            frame.close();
          }
        }),
      );
    },
    dispose() {
      for (const s of samplers.values()) s.dispose();
      samplers.clear();
      images.clear();
      uploaded.clear();
    },
  };
}

function decodeImage(url: string): Promise<HTMLImageElement | null> {
  return new Promise((resolve) => {
    const img = new Image();
    img.crossOrigin = "anonymous";
    img.onload = () => resolve(img);
    img.onerror = () => resolve(null);
    img.src = url;
  });
}
