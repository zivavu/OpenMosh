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
  sourceIds: string[],
  renderer: GlRenderer,
): Promise<MediaExportLayers> {
  const byId = new Map(sources.map((s) => [s.id, s]));
  const wanted = sourceIds
    .map((id) => byId.get(id))
    .filter((s): s is SequenceSource => !!s);

  const images = new Map<string, HTMLImageElement>();
  const samplers = new Map<string, SlideVideoSampler>();
  /** Source whose frame is on each lane's texture, keyed by lane. */
  const uploaded = new Map<string, string>();

  // Videos are opened up front — creating a decoder mid-export would stall the
  // frame it happens on. Layer media is a handful of files at most, unlike the
  // sequence pool, so the images come along with them.
  await Promise.all(
    wanted.map(async (src) => {
      if (src.kind === "video") {
        const sampler = await SlideVideoSampler.create(src.file);
        if (sampler) samplers.set(src.id, sampler);
        return;
      }
      const img = await decodeImage(src.objectUrl);
      if (img) images.set(src.id, img);
    }),
  );

  return {
    async advance(layers) {
      for (const layer of layers) {
        const src = byId.get(layer.sourceId);
        if (!src) continue;

        if (src.kind === "image") {
          if (uploaded.get(layer.key) === src.id) continue;
          const img = images.get(src.id);
          if (!img) continue;
          renderer.updateLayerImage(layer.key, img);
          uploaded.set(layer.key, src.id);
          continue;
        }

        const sampler = samplers.get(src.id);
        if (!sampler) continue;
        uploaded.set(layer.key, src.id);
        const frame = await sampler.at(layer.sourceTime);
        if (frame) {
          renderer.updateLayerFrame(layer.key, frame);
          frame.close();
        }
      }
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
