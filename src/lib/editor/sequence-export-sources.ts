import type { GlRenderer } from "../gl/renderer";
import { SlideVideoSampler } from "../slideshow/video-sampler";
import type { SequenceSource } from "./sequence-sources.svelte";

/**
 * Export-side twin of `SequenceFrameDriver`. Same state machine — a segment's
 * video restarts when the segment is entered and advances one frame per
 * frame — but every upload is awaited, so the recorder writes the exact frame
 * rather than whatever the decoder happened to have ready.
 *
 * Samplers are created here rather than borrowed from the preview registry:
 * the preview's are parked at arbitrary positions, and an export must not
 * depend on where the user last left the playhead.
 */
export interface SequenceExportSources {
  /**
   * Upload the frame for `sourceId`, advancing a video source by `dtSec`.
   * Returns false when the caller should upload the primary file itself.
   */
  advance(sourceId: string | undefined, dtSec: number): Promise<boolean>;
  dispose(): void;
}

export async function createSequenceExportSources(
  sources: SequenceSource[],
  renderer: GlRenderer,
): Promise<SequenceExportSources> {
  const byId = new Map(sources.map((s) => [s.id, s]));
  const primaryId = sources.find((s) => s.primary)?.id ?? null;

  const images = new Map<string, HTMLImageElement>();
  const samplers = new Map<string, SlideVideoSampler>();

  await Promise.all(
    sources.map(async (src) => {
      if (src.kind === "image") {
        const img = await decodeImage(src.objectUrl);
        if (img) images.set(src.id, img);
        return;
      }
      // The primary video is decoded by the recorder's own lockstep generator.
      if (src.primary) return;
      const sampler = await SlideVideoSampler.create(src.file);
      if (sampler) samplers.set(src.id, sampler);
    }),
  );

  let currentId: string | null = null;
  let lastVideoId: string | null = null;

  return {
    async advance(sourceId, dtSec) {
      const id = sourceId ?? primaryId;
      const src = id ? byId.get(id) : undefined;
      if (!src) {
        currentId = null;
        lastVideoId = null;
        return false;
      }

      if (src.primary && src.kind === "video") {
        currentId = null;
        lastVideoId = null;
        return false;
      }

      if (src.kind === "image") {
        lastVideoId = null;
        if (currentId !== src.id) {
          const img = images.get(src.id);
          if (!img) return false;
          renderer.updateSourceImage(img);
          currentId = src.id;
        }
        return true;
      }

      const sampler = samplers.get(src.id);
      if (!sampler) return false;
      if (lastVideoId !== src.id) sampler.reset();
      const step = lastVideoId === src.id ? dtSec : 0;
      lastVideoId = src.id;
      currentId = src.id;
      const frame = await sampler.next(step);
      if (frame) {
        renderer.updateSourceFrame(frame);
        frame.close();
      }
      return true;
    },
    dispose() {
      for (const s of samplers.values()) s.dispose();
      samplers.clear();
      images.clear();
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
