import type { GlRenderer } from "../gl/renderer";
import type { SequenceSource, SequenceSourceRegistry } from "./sequence-sources.svelte";

export interface SequenceFrameDriverOptions {
  registry: SequenceSourceRegistry;
  /** Read per call: the renderer is rebuilt on WebGL context loss. */
  getRenderer: () => GlRenderer | null;
  /** Called once a late video upload lands, so a paused preview can redraw. */
  onUpload?: () => void;
}

/**
 * Uploads the source texture for whichever sequence segment is under the
 * playhead. Preview calls this once per animation frame, a paused scrub on
 * every redraw; either way the caller states where in the clip it wants to be,
 * so the frame shown at a given master time never depends on how playback got
 * there — and matches what the export writes.
 *
 * `advance` returns false only for the primary video, which the editor's own
 * player already drives (it owns the master clock and the preview audio) —
 * every other case is handled here, including "still decoding", where holding
 * the previous texture beats letting the primary paint over it.
 */
export class SequenceFrameDriver {
  #registry: SequenceSourceRegistry;
  #getRenderer: () => GlRenderer | null;
  #onUpload: (() => void) | undefined;

  /** Source whose frame is currently on the texture. */
  #currentId: string | null = null;
  /** Same latch for the outgoing (transition) source texture. */
  #outgoingId: string | null = null;
  #disposed = false;

  constructor(opts: SequenceFrameDriverOptions) {
    this.#registry = opts.registry;
    this.#getRenderer = opts.getRenderer;
    this.#onUpload = opts.onUpload;
  }

  /**
   * True when this driver owns the source texture for this frame. `sourceTime`
   * is where in the clip the segment wants to be — seconds since the segment
   * started, wrapped by the sampler.
   */
  advance(sourceId: string | null, sourceTime: number): boolean {
    const src = this.#registry.get(sourceId);
    if (!src) {
      this.#currentId = null;
      return false;
    }

    if (src.primary && src.kind === "video") {
      // The editor's player is already uploading this video's frames. Forget
      // the texture state so returning to another source re-uploads it.
      this.#currentId = null;
      return false;
    }

    if (src.kind === "image") {
      if (this.#currentId !== src.id) {
        const img = this.#registry.image(src.id);
        if (img?.complete) {
          this.#getRenderer()?.updateSourceImage(img);
          this.#currentId = src.id;
        }
      }
      return true;
    }

    const sampler = this.#registry.sampler(src.id);
    if (sampler) {
      this.#currentId = src.id;
      // Non-blocking — see MediaLayerDriver. The export twin
      // (sequence-export-sources.ts) is the one that waits.
      void sampler.at(sourceTime, false).then((frame) => {
        if (!frame) return;
        if (!this.#disposed) {
          this.#getRenderer()?.updateSourceFrame(frame);
          this.#onUpload?.();
        }
        frame.close();
      });
    }
    return true;
  }

  /**
   * Upload the *outgoing* segment's media into the renderer's second source
   * texture, so a transition across two different sources cross-fades the
   * media and not just the effect chains.
   *
   * Returns false when the caller has to supply it instead — the primary video
   * is decoded by the editor's own player, which is the only place its current
   * frame exists. Pass `null` when no transition is running, which releases the
   * texture so a later one can't blend from a stale frame.
   */
  advanceOutgoing(sourceId: string | null, sourceTime: number): boolean {
    if (!sourceId) {
      if (this.#outgoingId !== null) {
        this.#outgoingId = null;
        this.#getRenderer()?.clearAltSource();
      }
      return true;
    }
    const src = this.#registry.get(sourceId);
    if (!src) return true;

    if (src.primary && src.kind === "video") {
      this.#outgoingId = src.id;
      return false;
    }

    if (src.kind === "image") {
      if (this.#outgoingId !== src.id) {
        const img = this.#registry.image(src.id);
        if (img?.complete) {
          this.#getRenderer()?.updateAltSourceImage(img);
          this.#outgoingId = src.id;
        }
      }
      return true;
    }

    const sampler = this.#registry.sampler(src.id);
    if (!sampler) return true;
    // Measured from the *outgoing* segment's start, so the clip carries on past
    // the boundary instead of restarting under the fade.
    this.#outgoingId = src.id;
    void sampler.at(sourceTime, false).then((frame) => {
      if (!frame) return;
      if (!this.#disposed) {
        this.#getRenderer()?.updateAltSourceFrame(frame);
        this.#onUpload?.();
      }
      frame.close();
    });
    return true;
  }

  /** Force the next call to re-upload, e.g. after the renderer was rebuilt. */
  invalidate() {
    this.#currentId = null;
    this.#outgoingId = null;
  }

  dispose() {
    this.#disposed = true;
  }
}
