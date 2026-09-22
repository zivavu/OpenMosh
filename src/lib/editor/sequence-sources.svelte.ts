import {
	createSourceEdit,
	isIdleSourceEdit,
	normalizeSourceEdits,
	type SourceEdit,
} from "../media";
import { GeneratedSizeSync, readGenerated } from "../generators";
import { gifsToVideo } from "../media/gif";
import { probeSlideVideo, SlideVideoSampler } from "../slideshow/video-sampler";
import { needsProxy, startProxyJob, type ProxyJob } from "../video/proxy";
import { isProxyDisabled, setProxyDisabled } from "../video/proxy-preference";
import {
	deleteSequenceMediaProxy,
	getAllSequenceMedia,
	getSequenceMediaProxy,
	putSequenceMedia,
	putSequenceMediaProxy,
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

export interface SequenceSource {
	id: string;
	file: File;
	name: string;
	kind: "image" | "video";
	objectUrl: string;
	/** Grid thumbnail; images fill theirs in after the chip is on screen. */
	thumbUrl: string | null;
	/** Whether a thumbnail is still coming; a null `thumbUrl` alone can't say. */
	thumbPending: boolean;
	/** Videos only, from the add-time probe. */
	width?: number;
	height?: number;
	/** Videos only; 0 for images. */
	duration: number;
	/** <=1080p stand-in the preview decodes; exports still read `file`. */
	proxyFile?: File;
	/** Proxy size: target while transcoding, finished size after; absent means still looking. */
	proxyWidth?: number;
	proxyHeight?: number;
	proxyPending?: boolean;
	/** 0-1, while `proxyPending`. */
	proxyProgress?: number;
	/** Transcoding failed; previews stay on the original. */
	proxyFailed?: boolean;
	proxyReason?: string;
	/** User asked this video to preview from the original (see video/proxy-preference.ts). */
	proxyDisabled?: boolean;
}

/** The media pool behind sequence mode; video decoding belongs to the layer driver. */
export class SequenceSourceRegistry {
	sources = $state<SequenceSource[]>([]);

	/** Per-source edits, keyed by id; an edit belongs to the media across the pool. */
	edits = $state<Record<string, SourceEdit>>({});

	/** Files in-flight `add` calls are working through, and how many are done. */
	loadingTotal = $state(0);
	loadingDone = $state(0);
	/** Overlapping loads share the counters; the last one out clears them. */
	#loads = 0;

	/** Insertion-ordered LRU of decoded images (see MAX_DECODED_IMAGES). */
	#images = new Map<string, HTMLImageElement>();
	#decoding = new Set<string>();
	/** Ids an in-flight `add` has claimed but not appended yet. */
	#pendingIds = new Set<string>();
	/** In-flight proxy transcodes, keyed by id, so remove() can stop one. */
	#proxyJobs = new Map<string, ProxyJob>();
	#disposed = false;
	#onReady: (() => void) | undefined;
	/** Generated images follow the output size; a re-render swaps the URL and drops the decode. */
	#sizeSync = new GeneratedSizeSync((id, url) => {
		const live = this.get(id);
		if (!live || this.#disposed) {
			URL.revokeObjectURL(url);
			return;
		}
		const old = live.objectUrl;
		live.objectUrl = url;
		this.#images.delete(id);
		URL.revokeObjectURL(old);
		this.#onReady?.();
	});

	/** Notified when a lazy decode lands, so a paused preview can redraw. */
	constructor(onReady?: () => void) {
		this.#onReady = onReady;
	}

	get(id: string | null | undefined): SequenceSource | undefined {
		if (!id) return undefined;
		return this.sources.find((s) => s.id === id);
	}

	#beginLoad(count: number) {
		this.#loads++;
		this.loadingTotal += count;
	}

	#endLoad() {
		if (--this.#loads === 0) {
			this.loadingTotal = 0;
			this.loadingDone = 0;
		}
	}

	/** Ends a span whose files another load takes over; leaving them counted would double-count. */
	#handOffLoad(count: number) {
		this.loadingTotal -= count;
		this.#endLoad();
	}

	async add(files: File[], { persist = true } = {}): Promise<SequenceSource[]> {
		// Animated GIFs become videos here, before anything is keyed on the file.
		files = await gifsToVideo(files);
		// Ids are reserved before the first await: probing is async, so overlapping
		// calls would both see an empty pool and append a duplicate key.
		const fresh = files.filter((f) => {
			const id = stableSourceId(f);
			if (this.get(id) || this.#pendingIds.has(id)) return false;
			this.#pendingIds.add(id);
			return true;
		});

		const images = fresh.filter((f) => !f.type.startsWith("video/"));
		const videos = fresh.filter((f) => f.type.startsWith("video/"));

		const ok: SequenceSource[] = [];
		this.#beginLoad(fresh.length);
		try {
			// Images need no pixels to enter the pool, so chips appear in one frame
			// instead of waiting on a decode and encode each.
			if (images.length > 0) {
				const batch = this.#accept(images.map((f) => this.#buildImage(f)));
				if (this.#disposed) return [];
				ok.push(...batch);
				this.loadingDone += images.length;
				void this.#fillThumbnails(batch).catch(() => {});
				for (const s of batch) {
					void readGenerated(s.file).then((info) => {
						if (info && !this.#disposed && this.get(s.id))
							this.#sizeSync.track(s.id, info.spec, info.width, info.height);
					});
				}
			}

			// Videos still need probing up front: it rejects undecodable files and
			// supplies the duration.
			for (let i = 0; i < videos.length; i += ADD_BATCH_SIZE) {
				const slice = videos.slice(i, i + ADD_BATCH_SIZE);
				const built = await Promise.all(slice.map((f) => this.#buildVideo(f)));
				const batch = this.#accept(built);
				// Counted per file probed, not per source accepted: a failed file is still
				// one the user stopped waiting on.
				this.loadingDone += slice.length;
				if (this.#disposed) return [];
				ok.push(...batch);
				// Started only once the source is in the pool: the job's callbacks resolve
				// the source by id.
				for (const s of batch) {
					if (s.proxyPending) void this.#makeProxy(s.id, s.file);
				}
			}
		} finally {
			// Released after the appends, so a waiting call sees the sources rather than
			// re-adding them.
			for (const f of fresh) this.#pendingIds.delete(stableSourceId(f));
			this.#endLoad();
		}

		if (persist) {
			// No prune here: these blobs belong to no song's pool yet, and pruning now
			// would evict the batch just written.
			void putSequenceMedia(ok.map((s) => ({ id: s.id, file: s.file }))).catch(
				() => {
					// Storage full or blocked; the pool still works for this session.
				},
			);
		}
		return ok;
	}

	/** The edit for this source, defaults included. */
	editFor(id: string): SourceEdit {
		return this.edits[id] ?? createSourceEdit();
	}

	/** An idle edit is dropped rather than stored, so the map stays sparse. */
	setEdit(id: string, edit: SourceEdit) {
		const next = { ...this.edits };
		if (isIdleSourceEdit(edit)) delete next[id];
		else next[id] = edit;
		this.edits = next;
	}

	/** Restore saved edits; not filtered against the pool, which arrives a tick later. */
	restoreEdits(raw: unknown) {
		this.edits = normalizeSourceEdits(raw);
	}

	/** Drops the source from this song; the stored blob stays for other pools. */
	remove(id: string) {
		const src = this.get(id);
		if (!src) return;
		this.#proxyJobs.get(id)?.cancel();
		this.#proxyJobs.delete(id);
		this.sources = this.sources.filter((s) => s.id !== id);
		if (this.edits[id]) {
			const next = { ...this.edits };
			delete next[id];
			this.edits = next;
		}
		this.#images.delete(id);
		this.#sizeSync.untrack(id);
		this.#revoke(src);
	}

	setOutputSize(width: number, height: number) {
		this.#sizeSync.resize(width, height);
	}

	/** Wait for any generated image still catching up with a size change. */
	settleGenerated(): Promise<void> {
		return this.#sizeSync.settle();
	}

	/** Move a source to another slot; assignments ride on ids, not order. */
	reorder(from: number, to: number) {
		const list = [...this.sources];
		if (from === to) return;
		if (from < 0 || from >= list.length || to < 0 || to >= list.length) return;
		const [moved] = list.splice(from, 1);
		list.splice(to, 0, moved);
		this.sources = list;
	}

	clear() {
		for (const s of [...this.sources]) this.remove(s.id);
	}

	/** Make the pool exactly `ids`, pulling missing ones from storage. */
	async setPool(ids: string[]): Promise<void> {
		const want = new Set(ids);
		for (const s of [...this.sources]) {
			if (!want.has(s.id)) this.remove(s.id);
		}
		await this.restore(ids);
	}

	/** Pulls stored media back into the pool; only ids saved clips reference are restored. */
	async restore(wantedIds: Iterable<string>): Promise<void> {
		const wanted = new Set(wantedIds);
		for (const s of this.sources) wanted.delete(s.id);
		if (wanted.size === 0) return;
		let stored: StoredSequenceMedia[];
		// Reading a pool back is part of the wait the placeholder covers, so the
		// counters stay open until the add takes over.
		this.#beginLoad(wanted.size);
		try {
			stored = await getAllSequenceMedia();
		} catch {
			return;
		} finally {
			this.#handOffLoad(wanted.size);
		}
		const files = stored.filter((e) => wanted.has(e.id)).map(storedMediaToFile);
		if (files.length > 0) await this.add(files, { persist: false });
	}

	/** Undefined while the image decodes; the caller holds the previous frame. */
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

	/** Turn the preview proxy on or off; the choice persists across sessions and modes. */
	setProxyEnabled(id: string, enabled: boolean) {
		const src = this.get(id);
		if (!src || src.kind !== "video") return;
		setProxyDisabled(src.file, !enabled);
		this.#proxyJobs.get(id)?.cancel();
		this.#proxyJobs.delete(id);
		src.proxyFile = undefined;
		src.proxyWidth = undefined;
		src.proxyHeight = undefined;
		src.proxyProgress = undefined;
		src.proxyFailed = false;
		src.proxyReason = undefined;
		src.proxyDisabled = !enabled;
		const wanted = enabled && needsProxy(src.width ?? 0, src.height ?? 0);
		src.proxyPending = wanted;
		if (wanted) void this.#makeProxy(id, src.file);
	}

	retryProxy(id: string) {
		const src = this.get(id);
		if (!src || src.kind !== "video" || !src.proxyFailed) return;
		src.proxyFailed = false;
		src.proxyReason = undefined;
		src.proxyWidth = undefined;
		src.proxyHeight = undefined;
		src.proxyPending = true;
		void this.#makeProxy(id, src.file);
	}

	dispose() {
		this.#disposed = true;
		this.#sizeSync.dispose();
		for (const job of this.#proxyJobs.values()) job.cancel();
		this.#proxyJobs.clear();
		this.#images.clear();
		this.#decoding.clear();
		this.#pendingIds.clear();
		this.loadingTotal = 0;
		this.loadingDone = 0;
		for (const s of this.sources) this.#revoke(s);
		this.sources = [];
	}

	/** Append the ones that are still wanted, discarding late duplicates. */
	#accept(built: (SequenceSource | null)[]): SequenceSource[] {
		const batch: SequenceSource[] = [];
		for (const s of built) {
			if (!s) continue;
			// Belt and braces: anything that slipped in behind us is dropped.
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

	/** Fills in image thumbnails once chips are on screen; also the validation pass. */
	async #fillThumbnails(list: SequenceSource[]) {
		let next = 0;
		const worker = async () => {
			while (next < list.length && !this.#disposed) {
				const src = list[next++];
				const thumb = await makeThumbUrl(src.file);
				// Removed while we were decoding, or the registry is gone.
				const live = this.#disposed ? undefined : this.get(src.id);
				if (!live) {
					if (thumb) URL.revokeObjectURL(thumb.url);
					continue;
				}
				if (!thumb) {
					this.remove(src.id);
					continue;
				}
				// `sources` is $state, so assigning through the proxy updates the chip.
				live.thumbUrl = thumb.url;
				live.thumbPending = false;
				live.width = thumb.width;
				live.height = thumb.height;
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

	/** Synchronous: an image needs no decoding to become a pool entry. */
	#buildImage(file: File): SequenceSource {
		return {
			id: stableSourceId(file),
			file,
			name: file.name,
			objectUrl: URL.createObjectURL(file),
			kind: "image",
			thumbUrl: null,
			thumbPending: true,
			duration: 0,
		};
	}

	async #buildVideo(file: File): Promise<SequenceSource | null> {
		const objectUrl = URL.createObjectURL(file);
		const probe = await probeSlideVideo(file);
		if (!probe) {
			URL.revokeObjectURL(objectUrl);
			return null;
		}
		const eligible = needsProxy(probe.width, probe.height);
		// Read here, not when the job starts: the user's choice decides whether there
		// is a job at all.
		const optedOut = eligible && isProxyDisabled(file);
		return {
			id: stableSourceId(file),
			file,
			name: file.name,
			objectUrl,
			kind: "video",
			thumbUrl: probe.thumb ? URL.createObjectURL(probe.thumb) : null,
			// Settled either way: the probe is the only shot at a video thumbnail.
			thumbPending: false,
			width: probe.width,
			height: probe.height,
			duration: probe.duration,
			// The job starts after the append; see add().
			proxyPending: eligible && !optedOut,
			proxyDisabled: eligible && optedOut,
		};
	}

	/** Attach a <=1080p preview proxy; previews use the original until it lands. */
	async #makeProxy(id: string, file: File) {
		const stored = await getSequenceMediaProxy(file);
		let proxy = stored;
		if (!proxy) {
			const job = startProxyJob(file, {
				onProgress: (progress) => {
					const live = this.get(id);
					if (live) live.proxyProgress = progress;
				},
				onSized: (width, height) => {
					const live = this.get(id);
					if (live) {
						live.proxyWidth = width;
						live.proxyHeight = height;
					}
				},
				onFailed: (reason) => {
					const live = this.get(id);
					if (live) live.proxyReason = reason;
				},
			});
			this.#proxyJobs.set(id, job);
			proxy = await job.promise;
			this.#proxyJobs.delete(id);
		}
		if (this.#disposed) return;
		// A proxy that won't open is worse than none, so it gets the same decodability check.
		let opened: { width: number; height: number } | null = null;
		if (proxy) {
			const sampler = await SlideVideoSampler.create(proxy);
			if (sampler) opened = { width: sampler.width, height: sampler.height };
			sampler?.dispose();
			if (!sampler) {
				proxy = null;
				// A stored one that no longer opens has to go, or the retry finds it again.
				if (stored) void deleteSequenceMediaProxy(file).catch(() => {});
			}
		}
		const live = this.get(id);
		if (!live) return;
		// Persisted under the source's own id so the next run skips the transcode.
		if (proxy && !stored)
			void putSequenceMediaProxy(file, proxy).catch(() => {});
		// Turned off while the transcode ran: stored above, but the source's state stays put.
		if (live.proxyDisabled) return;
		if (proxy) {
			live.proxyFile = proxy;
			live.proxyWidth = opened?.width;
			live.proxyHeight = opened?.height;
			live.proxyPending = false;
			live.proxyProgress = undefined;
		} else {
			live.proxyPending = false;
			live.proxyFailed = true;
		}
	}
}

/** Cover-cropped square JPEG for a chip, as an object URL. */
async function makeThumbUrl(
	file: File,
	size = THUMB_SIZE,
): Promise<{ url: string; width: number; height: number } | null> {
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
		ctx.drawImage(
			bitmap,
			(w - crop) / 2,
			(h - crop) / 2,
			crop,
			crop,
			0,
			0,
			size,
			size,
		);
		const blob = await canvas.convertToBlob({
			type: "image/jpeg",
			quality: 0.8,
		});
		return { url: URL.createObjectURL(blob), width: w, height: h };
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
