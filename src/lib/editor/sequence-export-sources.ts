import type { GlRenderer } from "../gl/renderer";
import { SlideVideoSampler } from "../slideshow/video-sampler";
import type { SequenceSource } from "./sequence-sources.svelte";

/**
 * Export-side twin of `SequenceFrameDriver`. Same state machine — the caller
 * states where in the clip each segment wants to be — but every upload is
 * awaited, so the recorder writes the exact frame rather than whatever the
 * decoder happened to have ready.
 *
 * Samplers are created here rather than borrowed from the preview registry:
 * the preview's are parked at arbitrary positions, and an export must not
 * depend on where the user last left the playhead.
 */
/** Mirrors the preview registry's cap. */
const MAX_DECODED_IMAGES = 16;

export interface SequenceExportSources {
  /**
   * Upload the frame for `sourceId`, taking a video source to `sourceTime`
   * seconds into its clip. Returns false when the caller should upload the
   * primary file itself.
   */
  advance(sourceId: string | undefined, sourceTime: number): Promise<boolean>;
  /**
   * Upload the outgoing side of a transition into the renderer's second source
   * texture. Returns false when the primary is the outgoing source, which the
   * recorder's own decode loop has to supply. `null` releases it.
   */
  advanceOutgoing(
    sourceId: string | null | undefined,
    sourceTime: number,
  ): Promise<boolean>;
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

  // Videos are opened up front — creating a decoder mid-export would stall the
  // frame it happens on. Images are decoded on first use instead: a pool can
  // hold hundreds, and holding every full-resolution bitmap for the length of
  // an export is what actually runs the tab out of memory.
  await Promise.all(
    sources
      .filter((src) => src.kind === "video" && !src.primary)
      .map(async (src) => {
        const sampler = await SlideVideoSampler.create(src.file);
        if (sampler) samplers.set(src.id, sampler);
      }),
  );

  let currentId: string | null = null;
  let outgoingId: string | null = null;

  /** Shared by both sides; `images` is the cache, bounded below. */
  async function resolveImage(
    src: SequenceSource,
  ): Promise<HTMLImageElement | null> {
    const hit = images.get(src.id);
    if (hit) return hit;
    const decoded = await decodeImage(src.objectUrl);
    if (!decoded) return null;
    images.set(src.id, decoded);
    if (images.size > MAX_DECODED_IMAGES) {
      const oldest = images.keys().next().value;
      if (oldest !== undefined && oldest !== src.id) images.delete(oldest);
    }
    return decoded;
  }

  return {
    async advance(sourceId, sourceTime) {
      const id = sourceId ?? primaryId;
      const src = id ? byId.get(id) : undefined;
      if (!src) {
        currentId = null;
        return false;
      }

      if (src.primary && src.kind === "video") {
        currentId = null;
        return false;
      }

      if (src.kind === "image") {
        if (currentId !== src.id) {
          const img = await resolveImage(src);
          if (!img) return false;
          renderer.updateSourceImage(img);
          currentId = src.id;
        }
        return true;
      }

      const sampler = samplers.get(src.id);
      if (!sampler) return false;
      currentId = src.id;
      const frame = await sampler.at(sourceTime);
      if (frame) {
        renderer.updateSourceFrame(frame);
        frame.close();
      }
      return true;
    },
    async advanceOutgoing(sourceId, sourceTime) {
      if (!sourceId) {
        if (outgoingId !== null) {
          outgoingId = null;
          renderer.clearAltSource();
        }
        return true;
      }
      const src = byId.get(sourceId);
      if (!src) return true;

      if (src.primary && src.kind === "video") {
        outgoingId = src.id;
        return false;
      }

      if (src.kind === "image") {
        if (outgoingId !== src.id) {
          const img = await resolveImage(src);
          if (!img) return true;
          renderer.updateAltSourceImage(img);
          outgoingId = src.id;
        }
        return true;
      }

      const sampler = samplers.get(src.id);
      if (!sampler) return true;
      // Measured from the outgoing segment's start, so the clip carries on past
      // the boundary instead of restarting under the fade.
      outgoingId = src.id;
      const frame = await sampler.at(sourceTime);
      if (frame) {
        renderer.updateAltSourceFrame(frame);
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
