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
 * playhead. Preview calls this once per animation frame; a paused scrub calls
 * it with dt 0.
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
  /** Video source advanced on the previous call; a change restarts playback. */
  #lastVideoId: string | null = null;
  /** Same pair of latches for the outgoing (transition) source texture. */
  #outgoingId: string | null = null;
  #lastOutgoingVideoId: string | null = null;
  #disposed = false;

  constructor(opts: SequenceFrameDriverOptions) {
    this.#registry = opts.registry;
    this.#getRenderer = opts.getRenderer;
    this.#onUpload = opts.onUpload;
  }

  /** True when this driver owns the source texture for this frame. */
  advance(sourceId: string | null, dt: number): boolean {
    const src = this.#registry.get(sourceId);
    if (!src) {
      this.#currentId = null;
      this.#lastVideoId = null;
      return false;
    }

    if (src.primary && src.kind === "video") {
      // The editor's player is already uploading this video's frames. Forget
      // the texture state so returning to another source re-uploads it.
      this.#currentId = null;
      this.#lastVideoId = null;
      return false;
    }

    if (src.kind === "image") {
      this.#lastVideoId = null;
      if (this.#currentId !== src.id) {
        const img = this.#registry.image(src.id);
        if (img?.complete) {
          this.#getRenderer()?.updateSourceImage(img);
          this.#currentId = src.id;
        }
      }
      return true;
    }

    this.#advanceVideo(src, dt);
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
  advanceOutgoing(sourceId: string | null, dt: number): boolean {
    if (!sourceId) {
      if (this.#outgoingId !== null) {
        this.#outgoingId = null;
        this.#lastOutgoingVideoId = null;
        this.#getRenderer()?.clearAltSource();
      }
      return true;
    }
    const src = this.#registry.get(sourceId);
    if (!src) return true;

    if (src.primary && src.kind === "video") {
      this.#outgoingId = src.id;
      this.#lastOutgoingVideoId = null;
      return false;
    }

    if (src.kind === "image") {
      this.#lastOutgoingVideoId = null;
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
    // No reset here: the outgoing clip keeps playing from where the segment
    // left it, which is what "fading out" should look like.
    const step = this.#lastOutgoingVideoId === src.id ? dt : 0;
    this.#lastOutgoingVideoId = src.id;
    this.#outgoingId = src.id;
    void sampler.next(step).then((frame) => {
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
    this.#lastVideoId = null;
    this.#outgoingId = null;
    this.#lastOutgoingVideoId = null;
  }

  dispose() {
    this.#disposed = true;
  }

  #advanceVideo(src: SequenceSource, dt: number) {
    const sampler = this.#registry.sampler(src.id);
    if (!sampler) return;
    // A segment re-entered from elsewhere restarts its video, so the same
    // playhead position always shows the same frame.
    if (this.#lastVideoId !== src.id) sampler.reset();
    const step = this.#lastVideoId === src.id ? dt : 0;
    this.#lastVideoId = src.id;
    this.#currentId = src.id;
    void sampler.next(step).then((frame) => {
      if (!frame) return;
      if (!this.#disposed) {
        this.#getRenderer()?.updateSourceFrame(frame);
        this.#onUpload?.();
      }
      frame.close();
    });
  }
}
