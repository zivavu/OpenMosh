import type { ProxyWorkerRequest, ProxyWorkerResponse } from "./proxy-worker";

/**
 * Preview proxies for oversized videos.
 *
 * A source above Full HD is re-encoded once, in the background, to a ≤1080p
 * stand-in that every preview path decodes instead of the original. Decode,
 * texture upload and queue memory all scale with pixel count, so this is the
 * one lever that makes QHD/4K previews smooth on machines that can't decode
 * them in real time — the renderer already runs at display resolution and
 * can't help. The worker profiles decode speed per file and drops the proxy
 * to HD on machines that can't decode the source at twice realtime. Exports
 * are untouched: they keep reading the original file, so output quality never
 * drops.
 */

/** Long-edge ceiling of a preview proxy. */
export const PROXY_LONG_EDGE = 1920;

/** Sources at or under this many pixels preview fine as-is. */
const PROXY_MAX_PIXELS = 1920 * 1080;

export function needsProxy(width: number, height: number): boolean {
	return width > 0 && height > 0 && width * height > PROXY_MAX_PIXELS;
}

/**
 * Even-dimensioned proxy size capping the long edge, never upscaling. Even
 * because H.264 encoders reject odd dimensions.
 */
export function proxyTargetSize(
	width: number,
	height: number,
): { width: number; height: number } {
	const scale = Math.min(1, PROXY_LONG_EDGE / Math.max(width, height));
	return {
		width: Math.max(2, Math.round((width * scale) / 2) * 2),
		height: Math.max(2, Math.round((height * scale) / 2) * 2),
	};
}

export interface ProxyJob {
	/** The proxy file, or null when transcoding failed or was canceled. */
	promise: Promise<File | null>;
	cancel(): void;
}

// ── Worker plumbing ──────────────────────────────────────────────────────────

let worker: Worker | null = null;
let workerUnavailable = false;

/** Jobs waiting on the worker, keyed by id — resolved if the worker dies. */
const pending = new Map<number, (file: File | null) => void>();

function getWorker(): Worker | null {
	if (worker) return worker;
	if (workerUnavailable) return null;
	if (typeof Worker === "undefined" || typeof VideoDecoder === "undefined") {
		workerUnavailable = true;
		return null;
	}
	try {
		const spawned = new Worker(new URL("./proxy-worker.ts", import.meta.url), {
			type: "module",
		});
		spawned.onerror = (event) => {
			// A worker that failed to load can't answer anything asked of it —
			// without this, every queued job would sit at 0% forever.
			workerUnavailable = true;
			worker = null;
			console.error("[proxy] worker failed to load", spawned, event.message);
			for (const settle of pending.values()) settle(null);
			pending.clear();
		};
		worker = spawned;
		return worker;
	} catch {
		workerUnavailable = true;
		return null;
	}
}

// One transcode at a time: concurrent jobs would thrash the very machine this
// exists to help, and the queue is invisible — each source previews from its
// original until its own proxy lands.
let chain: Promise<void> = Promise.resolve();
let nextJobId = 1;

export function startProxyJob(
	file: File,
	width: number,
	height: number,
	onProgress?: (progress: number) => void,
): ProxyJob {
	const id = nextJobId++;
	let canceled = false;
	const target = proxyTargetSize(width, height);

	const promise = new Promise<File | null>((resolve) => {
		// Resolved directly if the worker dies before this job's slot opens; the
		// running slot replaces it with a settle that also releases the chain.
		pending.set(id, resolve);
		chain = chain.then(
			() =>
				new Promise<void>((release) => {
					const settle = (result: File | null) => {
						pending.delete(id);
						resolve(result);
						release();
					};
					// While this job runs, a worker death must release the chain slot
					// too — the creation-time entry could only resolve the promise.
					pending.set(id, settle);
					if (canceled) {
						settle(null);
						return;
					}
					const target_ = getWorker();
					if (!target_) {
						settle(null);
						return;
					}
					const onMessage = (e: MessageEvent<ProxyWorkerResponse>) => {
						const msg = e.data;
						if (msg.id !== id) return;
						if (msg.type === "progress") {
							onProgress?.(msg.progress);
							return;
						}
						target_.removeEventListener("message", onMessage);
						if (msg.type === "done") {
							settle(new File([msg.blob], file.name, { type: "video/mp4" }));
						} else {
							// The worker logs the underlying error; this is what ties it
							// back to the file the user is looking at.
							console.warn(`[proxy] "${file.name}": ${msg.reason}`);
							settle(null);
						}
					};
					target_.addEventListener("message", onMessage);
					target_.postMessage({
						type: "convert",
						id,
						file,
						width: target.width,
						height: target.height,
					} satisfies ProxyWorkerRequest);
				}),
		);
	});

	return {
		promise,
		cancel() {
			canceled = true;
			// No-op for a job still queued (the slot-open check resolves it) and for
			// one already finished; the worker ignores unknown ids.
			getWorker()?.postMessage({
				type: "cancel",
				id,
			} satisfies ProxyWorkerRequest);
		},
	};
}
