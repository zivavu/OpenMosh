import { probeSlideVideo, SlideVideoSampler } from "../slideshow/video-sampler";
import {
  getAllSequenceMedia,
  putSequenceMedia,
  stableSourceId,
  storedMediaToFile,
  type StoredSequenceMedia,
} from "./sequence-media-store";

/** Full-resolution decodes held at once; the rest re-decode on demand. */
const MAX_DECODED_IMAGES = 16;
/** Videos probed concurrently while adding, to bound peak memory. */
const ADD_BATCH_SIZE = 8;
/** Thumbnails generated concurrently after the chips are already on screen. */
const THUMB_CONCURRENCY = 6;
/** Chip thumbnail edge, matching probeSlideVideo's default for videos. */
const THUMB_SIZE = 100;

/** One piece of media a sequence segment can draw from. */
export interface SequenceSource {
  id: string;
  file: File;
  name: string;
  kind: "image" | "video";
  objectUrl: string;
  /** Grid thumbnail. Null until generated — images fill theirs in after the
   * chip is already on screen. */
  thumbUrl: string | null;
  /** Videos only, from the add-time probe. Images enter the pool without
   * touching their pixels, so they carry no dimensions. */
  width?: number;
  height?: number;
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
  /** Ids an in-flight `add` has claimed but not appended yet. */
  #pendingIds = new Set<string>();
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
    // Ids are reserved before the first await, not just checked against the
    // current pool. Probing and decoding are async, so two overlapping calls —
    // the per-song pool restore and the segment-driven restore both pulling the
    // same media out of storage on load — would each see an empty pool and
    // append the same source, which is a duplicate key in the bin's keyed each.
    const fresh = files.filter((f) => {
      const id = stableSourceId(f);
      if (this.get(id) || this.#pendingIds.has(id)) return false;
      this.#pendingIds.add(id);
      return true;
    });

    const images = fresh.filter((f) => !f.type.startsWith("video/"));
    const videos = fresh.filter((f) => f.type.startsWith("video/"));

    const ok: SequenceSource[] = [];
    try {
      // Nothing about an image source needs its pixels — the dimensions were
      // never read, and the thumbnail can arrive later. So they go into the
      // pool synchronously and a few hundred chips appear in one frame instead
      // of waiting on a full-resolution decode and a JPEG encode each.
      if (images.length > 0) {
        const batch = this.#accept(images.map((f) => this.#buildImage(f, primary)));
        if (this.#disposed) return [];
        ok.push(...batch);
        void this.#fillThumbnails(batch).catch(() => {});
      }

      // Videos still need probing up front: it's what rejects undecodable
      // files and supplies the duration, and a pool rarely holds many.
      for (let i = 0; i < videos.length; i += ADD_BATCH_SIZE) {
        const built = await Promise.all(
          videos.slice(i, i + ADD_BATCH_SIZE).map((f) => this.#buildVideo(f, primary)),
        );
        const batch = this.#accept(built);
        if (this.#disposed) return [];
        ok.push(...batch);
      }
    } finally {
      // Released only after the appends, so a call waiting behind this one
      // sees the sources in the pool rather than re-adding them.
      for (const f of fresh) this.#pendingIds.delete(stableSourceId(f));
    }

    if (persist) {
      // No prune here: these blobs belong to no song's pool until the editor
      // saves one, and pruning now would evict the batch we just wrote.
      void putSequenceMedia(
        ok.map((s) => ({ id: s.id, file: s.file })),
      ).catch(() => {
        // Storage full or blocked — the pool still works for this session.
      });
    }
    return ok;
  }

  /**
   * Drops the source from this song. The stored blob is deliberately left
   * alone: another song's pool may reference the same media, and once none
   * does, `pruneSequenceMedia` collects it on the next pool save.
   */
  remove(id: string) {
    const src = this.get(id);
    if (!src) return;
    this.sources = this.sources.filter((s) => s.id !== id);
    this.#samplers.get(id)?.dispose();
    this.#samplers.delete(id);
    this.#images.delete(id);
    this.#revoke(src);
  }

  /** Drop every added source, keeping the primary. */
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
    for (const s of [...this.sources]) {
      if (!s.primary && !want.has(s.id)) this.remove(s.id);
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
    this.#creating.clear();
    this.#decoding.clear();
    this.#pendingIds.clear();
    for (const s of this.sources) this.#revoke(s);
    this.sources = [];
  }

  /** Append the ones that are still wanted, discarding late duplicates. */
  #accept(built: (SequenceSource | null)[]): SequenceSource[] {
    const batch: SequenceSource[] = [];
    for (const s of built) {
      if (!s) continue;
      // Belt and braces: anything that slipped in behind us is dropped rather
      // than duplicated.
      if (this.#disposed || this.get(s.id)) {
        this.#revoke(s);
        continue;
      }
      batch.push(s);
    }
    if (this.#disposed || batch.length === 0) return [];
    this.sources = [...this.sources, ...batch];
    return batch;
  }

  /**
   * Fills in image thumbnails once the chips are already on screen. Also the
   * validation pass: a file that won't decode isn't usable media, so it leaves
   * the pool again.
   */
  async #fillThumbnails(list: SequenceSource[]) {
    let next = 0;
    const worker = async () => {
      while (next < list.length && !this.#disposed) {
        const src = list[next++];
        const url = await makeThumbUrl(src.file);
        // Removed while we were decoding, or the registry is gone.
        const live = this.#disposed ? undefined : this.get(src.id);
        if (!live) {
          if (url) URL.revokeObjectURL(url);
          continue;
        }
        if (!url) {
          this.remove(src.id);
          continue;
        }
        // `sources` is $state, so assigning through the proxy updates the chip.
        live.thumbUrl = url;
      }
    };
    await Promise.all(
      Array.from({ length: Math.min(THUMB_CONCURRENCY, list.length) }, worker),
    );
  }

  #revoke(src: SequenceSource) {
    URL.revokeObjectURL(src.objectUrl);
    if (src.thumbUrl && src.thumbUrl !== src.objectUrl) {
      URL.revokeObjectURL(src.thumbUrl);
    }
  }

  /** Synchronous — an image needs no decoding to become a pool entry. */
  #buildImage(file: File, primary: boolean): SequenceSource {
    return {
      id: stableSourceId(file),
      file,
      name: file.name,
      objectUrl: URL.createObjectURL(file),
      primary,
      kind: "image",
      thumbUrl: null,
      duration: 0,
    };
  }

  async #buildVideo(
    file: File,
    primary: boolean,
  ): Promise<SequenceSource | null> {
    const objectUrl = URL.createObjectURL(file);
    const probe = await probeSlideVideo(file);
    if (!probe) {
      URL.revokeObjectURL(objectUrl);
      return null;
    }
    return {
      id: stableSourceId(file),
      file,
      name: file.name,
      objectUrl,
      primary,
      kind: "video",
      thumbUrl: probe.thumb ? URL.createObjectURL(probe.thumb) : null,
      width: probe.width,
      height: probe.height,
      duration: probe.duration,
    };
  }
}

/**
 * Cover-cropped square JPEG for a chip, as an object URL.
 *
 * `createImageBitmap` rather than an `<img>`: it decodes off the main thread
 * and the bitmap is closed straight after, so a few hundred of these don't
 * pile full-resolution decodes into memory. Pointing the chips at the original
 * files instead would make the browser decode full-size screenshots to fill
 * 58px boxes.
 */
async function makeThumbUrl(
  file: File,
  size = THUMB_SIZE,
): Promise<string | null> {
  let bitmap: ImageBitmap | undefined;
  try {
    bitmap = await createImageBitmap(file);
    const w = bitmap.width;
    const h = bitmap.height;
    if (w <= 0 || h <= 0) return null;
    const scale = Math.max(size / w, size / h);
    const crop = size / scale;
    const canvas = new OffscreenCanvas(size, size);
    const ctx = canvas.getContext("2d");
    if (!ctx) return null;
    ctx.drawImage(bitmap, (w - crop) / 2, (h - crop) / 2, crop, crop, 0, 0, size, size);
    const blob = await canvas.convertToBlob({ type: "image/jpeg", quality: 0.8 });
    return URL.createObjectURL(blob);
  } catch {
    // Not a decodable image, or no OffscreenCanvas.
    return null;
  } finally {
    bitmap?.close();
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
