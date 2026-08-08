import { probeSlideVideo, SlideVideoSampler } from "../slideshow/video-sampler";
import {
  deleteSequenceMedia,
  getAllSequenceMedia,
  pruneSequenceMedia,
  putSequenceMedia,
  stableSourceId,
  storedMediaToFile,
  type StoredSequenceMedia,
} from "./sequence-media-store";

/** One piece of media a sequence segment can draw from. */
export interface SequenceSource {
  id: string;
  file: File;
  name: string;
  kind: "image" | "video";
  objectUrl: string;
  /** Grid thumbnail. Images reuse `objectUrl`; videos get a first-frame JPEG. */
  thumbUrl: string | null;
  width: number;
  height: number;
  /** Videos only; 0 for images. */
  duration: number;
  /**
   * The file the editor was opened with. It owns the master clock and (when
   * it's a video) the preview audio, so its frames still come from the
   * editor's own player rather than from a sampler here.
   */
  primary?: boolean;
}

/**
 * The media pool behind sequence mode. Owns object URLs, decoded images and
 * lazily-created video samplers; segments reference entries by id.
 *
 * Videos reuse the slideshow's `SlideVideoSampler` — sequential, caller-driven
 * decode with no clock of its own, which is exactly what a segment needs.
 */
export class SequenceSourceRegistry {
  sources = $state<SequenceSource[]>([]);

  #images = new Map<string, HTMLImageElement>();
  #samplers = new Map<string, SlideVideoSampler>();
  /** Samplers whose create() is in flight, so we don't start a second one. */
  #creating = new Set<string>();
  #disposed = false;

  get(id: string | null | undefined): SequenceSource | undefined {
    if (!id) return undefined;
    return this.sources.find((s) => s.id === id);
  }

  get primaryId(): string | null {
    return this.sources.find((s) => s.primary)?.id ?? null;
  }

  /**
   * Adds files in the given order, skipping any that can't be decoded and any
   * already in the pool (ids are content-derived, so re-adding is idempotent).
   * `persist` false is for entries coming back out of the store.
   */
  async add(
    files: File[],
    { primary = false, persist = true } = {},
  ): Promise<SequenceSource[]> {
    const fresh = files.filter((f) => !this.get(stableSourceId(f)));
    const built = await Promise.all(fresh.map((f) => this.#build(f, primary)));
    const ok = built.filter((s): s is SequenceSource => s !== null);
    if (this.#disposed) {
      for (const s of ok) this.#revoke(s);
      return [];
    }
    this.sources = [...this.sources, ...ok];
    if (persist) {
      void (async () => {
        for (const s of ok) await putSequenceMedia(s.id, s.file);
        await pruneSequenceMedia();
      })().catch(() => {
        // Storage full or blocked — the pool still works for this session.
      });
    }
    return ok;
  }

  remove(id: string) {
    const src = this.get(id);
    if (!src) return;
    this.sources = this.sources.filter((s) => s.id !== id);
    this.#samplers.get(id)?.dispose();
    this.#samplers.delete(id);
    this.#images.delete(id);
    this.#revoke(src);
    void deleteSequenceMedia(id).catch(() => {});
  }

  /**
   * Pulls previously-stored media back into the pool. Only ids that saved
   * segments actually reference are restored, so an unrelated earlier session's
   * files don't pile into the bin.
   */
  async restore(wantedIds: Iterable<string>): Promise<void> {
    const wanted = new Set(wantedIds);
    for (const s of this.sources) wanted.delete(s.id);
    if (wanted.size === 0) return;
    let stored: StoredSequenceMedia[];
    try {
      stored = await getAllSequenceMedia();
    } catch {
      return;
    }
    const files = stored
      .filter((e) => wanted.has(e.id))
      .map(storedMediaToFile);
    if (files.length > 0) await this.add(files, { persist: false });
  }

  /** Decoded at add time, so this is a plain lookup. */
  image(id: string): HTMLImageElement | undefined {
    return this.#images.get(id);
  }

  /**
   * Returns undefined while the sampler is still being created — the caller
   * holds the previous frame and retries next tick.
   */
  sampler(id: string): SlideVideoSampler | undefined {
    const existing = this.#samplers.get(id);
    if (existing) return existing;
    if (this.#creating.has(id)) return undefined;
    const src = this.get(id);
    if (!src || src.kind !== "video") return undefined;
    this.#creating.add(id);
    void SlideVideoSampler.create(src.file).then((sampler) => {
      this.#creating.delete(id);
      if (!sampler) return;
      if (this.#disposed || !this.get(id)) {
        sampler.dispose();
        return;
      }
      this.#samplers.set(id, sampler);
    });
    return undefined;
  }

  dispose() {
    this.#disposed = true;
    for (const s of this.#samplers.values()) s.dispose();
    this.#samplers.clear();
    this.#images.clear();
    for (const s of this.sources) this.#revoke(s);
    this.sources = [];
  }

  #revoke(src: SequenceSource) {
    URL.revokeObjectURL(src.objectUrl);
    if (src.thumbUrl && src.thumbUrl !== src.objectUrl) {
      URL.revokeObjectURL(src.thumbUrl);
    }
  }

  async #build(file: File, primary: boolean): Promise<SequenceSource | null> {
    const objectUrl = URL.createObjectURL(file);
    const id = stableSourceId(file);
    const base = { id, file, name: file.name, objectUrl, primary };

    if (file.type.startsWith("video/")) {
      const probe = await probeSlideVideo(file);
      if (!probe) {
        URL.revokeObjectURL(objectUrl);
        return null;
      }
      return {
        ...base,
        kind: "video",
        thumbUrl: probe.thumb ? URL.createObjectURL(probe.thumb) : null,
        width: probe.width,
        height: probe.height,
        duration: probe.duration,
      };
    }

    const img = await decodeImage(objectUrl);
    if (!img) {
      URL.revokeObjectURL(objectUrl);
      return null;
    }
    this.#images.set(id, img);
    return {
      ...base,
      kind: "image",
      thumbUrl: objectUrl,
      width: img.naturalWidth,
      height: img.naturalHeight,
      duration: 0,
    };
  }
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
