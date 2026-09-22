import type { ProxyWorkerRequest, ProxyWorkerResponse } from "./proxy-worker";

/** Preview proxies for oversized videos: a source above Full HD is re-encoded
 * once, in the background, to a <=1080p stand-in every preview path decodes. */

/** Which build of the transcoder made a proxy. Bumped whenever a change here
 * would produce a different file; a stored proxy is reused for the profile. */
export const PROXY_BUILD = 2;

/** Sources at or under this many pixels preview fine as-is. */
const PROXY_MAX_PIXELS = 1920 * 1080;

export function needsProxy(width: number, height: number): boolean {
	return width > 0 && height > 0 && width * height > PROXY_MAX_PIXELS;
}

export interface ProxyJob {
	/** The proxy file, or null when transcoding failed or was canceled. */
	promise: Promise<File | null>;
	cancel(): void;
}

/** Optional progress callbacks; the job resolves to the same file either way. */
export interface ProxyJobHandlers {
	/** 0 to 1. */
	onProgress?: (progress: number) => void;
	/** The proxy's size, known after the benchmark and before the encode starts. */
	onSized?: (width: number, height: number) => void;
	/** Why the transcode failed, for a message that says more than "failed". */
	onFailed?: (reason: string) => void;
}

let worker: Worker | null = null;
let workerUnavailable = false;

/** Jobs waiting on the worker, keyed by id; resolved if the worker dies. */
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
			// A worker that failed to load can't answer anything; without this every job sits at 0%.
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

// One transcode at a time: concurrent jobs would thrash the machine this helps.
let chain: Promise<void> = Promise.resolve();
let nextJobId = 1;

export function startProxyJob(
	file: File,
	handlers: ProxyJobHandlers = {},
): ProxyJob {
	const id = nextJobId++;
	let canceled = false;

	const promise = new Promise<File | null>((resolve) => {
		// Resolved directly if the worker dies before this job's slot opens.
		pending.set(id, resolve);
		chain = chain.then(
			() =>
				new Promise<void>((release) => {
					const settle = (result: File | null) => {
						pending.delete(id);
						resolve(result);
						release();
					};
					// While this job runs, a worker death must release the chain slot too.
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
							handlers.onProgress?.(msg.progress);
							return;
						}
						if (msg.type === "sized") {
							handlers.onSized?.(msg.width, msg.height);
							return;
						}
						target_.removeEventListener("message", onMessage);
						if (msg.type === "done") {
							settle(new File([msg.blob], file.name, { type: "video/mp4" }));
						} else {
							// The worker logs the underlying error; this ties it to the user's file.
							console.warn(`[proxy] "${file.name}": ${msg.reason}`);
							handlers.onFailed?.(msg.reason);
							settle(null);
						}
					};
					target_.addEventListener("message", onMessage);
					// The worker sizes the proxy itself: it has the track and the decode speed.
					target_.postMessage({
						type: "convert",
						id,
						file,
					} satisfies ProxyWorkerRequest);
				}),
		);
	});

	return {
		promise,
		cancel() {
			canceled = true;
			// No-op for a queued or finished job; the worker ignores unknown ids.
			getWorker()?.postMessage({
				type: "cancel",
				id,
			} satisfies ProxyWorkerRequest);
		},
	};
}
