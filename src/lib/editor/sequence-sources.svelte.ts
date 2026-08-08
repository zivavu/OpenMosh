import { probeSlideVideo, SlideVideoSampler } from "../slideshow/video-sampler";
import {
  deleteSequenceMedia,
  getAllSequenceMedia,
  putSequenceMedia,
  stableSourceId,
  storedMediaToFile,
  type StoredSequenceMedia,
} from "./sequence-media-store";

/** Full-resolution decodes held at once; the rest re-decode on demand. */
const MAX_DECODED_IMAGES = 16;
/** Files decoded concurrently while adding, to bound peak memory. */
const ADD_BATCH_SIZE = 8;

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

  /** Insertion-ordered LRU of decoded images — see MAX_DECODED_IMAGES. */
  #images = new Map<string, HTMLImageElement>();
  #decoding = new Set<string>();
  #samplers = new Map<string, SlideVideoSampler>();
  /** Samplers whose create() is in flight, so we don't start a second one. */
  #creating = new Set<string>();
  #disposed = false;
  #onReady: (() => void) | undefined;

  /** Notified when a lazy decode lands, so a paused preview can redraw. */
  constructor(onReady?: () => void) {
    this.#onReady = onReady;
  }

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
    const seen = new Set<string>();
    const fresh = files.filter((f) => {
      const id = stableSourceId(f);
      if (this.get(id) || seen.has(id)) return false;
      seen.add(id);
      return true;
    });

    // Batched rather than one Promise.all: dropping a folder of a few hundred
    // images would otherwise hold every full-resolution decode in memory at
    // once. Each batch is appended as it lands, so the bin fills progressively.
    const ok: SequenceSource[] = [];
    for (let i = 0; i < fresh.length; i += ADD_BATCH_SIZE) {
      const built = await Promise.all(
        fresh.slice(i, i + ADD_BATCH_SIZE).map((f) => this.#build(f, primary)),
      );
      const batch = built.filter((s): s is SequenceSource => s !== null);
      if (this.#disposed) {
        for (const s of batch) this.#revoke(s);
        return [];
      }
      if (batch.length > 0) this.sources = [...this.sources, ...batch];
      ok.push(...batch);
    }

    if (persist) {
      // No prune here: these blobs belong to no song's pool until the editor
      // saves one, and pruning now would evict the batch we just wrote.
      void (async () => {
        for (const s of ok) await putSequenceMedia(s.id, s.file);
      })().catch(() => {
        // Storage full or blocked — the pool still works for this session.
      });
    }
    return ok;
  }

  /**
   * `forget` false drops the source from this session only, leaving the stored
   * blob alone — that's what swapping songs does, where another song's pool may
   * still reference the same media.
   */
  remove(id: string, { forget = true } = {}) {
    const src = this.get(id);
    if (!src) return;
    this.sources = this.sources.filter((s) => s.id !== id);
    this.#samplers.get(id)?.dispose();
    this.#samplers.delete(id);
    this.#images.delete(id);
    this.#revoke(src);
    if (forget) void deleteSequenceMedia(id).catch(() => {});
  }

  /** Drop every added source, keeping the primary. Deletes the stored blobs. */
  clearExtras() {
    for (const s of [...this.sources]) {
      if (!s.primary) this.remove(s.id);
    }
  }

  /**
   * Make the non-primary pool exactly `ids`, pulling any missing ones out of
   * storage. Used when the song changes: the primary source belongs to the
   * editor session, everything else belongs to the song.
   */
  async setExtras(ids: string[]): Promise<void> {
    const want = new Set(ids);
    for (const s of this.sources) {
      if (!s.primary && !want.has(s.id)) this.remove(s.id, { forget: false });
    }
    await this.restore(ids);
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

  /**
   * Returns undefined while the image is still being decoded — same contract
   * as `sampler`: the caller holds the previous frame and is called back via
   * `onReady`. Decoding eagerly at add time would pin every source's full
   * bitmap in memory, which a few hundred screenshots will not survive.
   */
  image(id: string): HTMLImageElement | undefined {
    const hit = this.#images.get(id);
    if (hit) {
      // Re-insert to mark as most recently used.
      this.#images.delete(id);
      this.#images.set(id, hit);
      return hit;
    }
    if (this.#decoding.has(id)) return undefined;
    const src = this.get(id);
    if (!src || src.kind !== "image") return undefined;
    this.#decoding.add(id);
    void decodeImage(src.objectUrl).then((img) => {
      this.#decoding.delete(id);
      if (!img || this.#disposed || !this.get(id)) return;
      this.#images.set(id, img);
      while (this.#images.size > MAX_DECODED_IMAGES) {
        const oldest = this.#images.keys().next().value;
        if (oldest === undefined) break;
        this.#images.delete(oldest);
      }
      this.#onReady?.();
    });
    return undefined;
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

    // Decoded only for its dimensions and to reject unreadable files; not
    // retained — `image()` re-decodes on demand into the bounded cache.
    const img = await decodeImage(objectUrl);
    if (!img) {
      URL.revokeObjectURL(objectUrl);
      return null;
    }
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
