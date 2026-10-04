import { showToast } from "../components/ui/toast.svelte";
import type { VideoPreviewPlayer } from "../video-preview/preview-player.svelte";
import { openVideoFrameSource } from "../video/frame-source";
import { needsProxy, startProxyJob, type ProxyJob } from "../video/proxy";
import { isProxyDisabled, setProxyDisabled } from "../video/proxy-preference";
import { proxyStatus } from "../video/proxy-status";
import {
	deleteSequenceMediaProxy,
	getSequenceMediaProxy,
	putSequenceMediaProxy,
} from "./sequence-media-store";

interface SingleProxyOptions {
	/** Single mode with a video open. */
	active: () => boolean;
	file: () => File;
	player: () => VideoPreviewPlayer | null;
}

/** Single mode's preview proxy. Its file is not pooled, so there's no registry: one job
 * per file. Construct during component init: the job runs from an effect. */
export class SingleProxy {
	proxy = $state<File | null>(null);
	/** The file `proxy` belongs to; plain, so a stale proxy can't leak into the player. */
	#proxyFor: File | null = null;
	#job: ProxyJob | null = null;
	#jobFor: File | null = null;
	/** Set on failure so it isn't retried in a loop; the toast's Retry clears it. */
	failed = $state(false);
	/** Single mode has no proxy chip, so it keeps the fields a pooled source carries. */
	pending = $state(false);
	progress = $state<number | undefined>(undefined);
	size = $state<{ width: number; height: number } | null>(null);
	reason = $state<string | undefined>(undefined);
	/** User asked to preview from the original; stored per file in video/proxy-preference.ts. */
	disabled = $state(false);
	readonly #opts: SingleProxyOptions;

	readonly status = $derived.by(() => {
		const player = this.#opts.player();
		return proxyStatus({
			width: player?.width,
			height: player?.height,
			proxyFile: this.proxy ?? undefined,
			proxyWidth: this.size?.width,
			proxyHeight: this.size?.height,
			proxyPending: this.pending,
			proxyProgress: this.progress,
			proxyFailed: this.failed,
			proxyReason: this.reason,
			// Only meaningful for media a proxy would be built for.
			proxyDisabled:
				this.disabled && needsProxy(player?.width ?? 0, player?.height ?? 0),
		});
	});

	constructor(opts: SingleProxyOptions) {
		this.#opts = opts;
		$effect(() => this.#run());
	}

	/** The proxy, if it was made for `file`. */
	forFile(file: File): File | null {
		return this.#proxyFor === file ? this.proxy : null;
	}

	#reset() {
		this.#job?.cancel();
		this.#job = null;
		this.#jobFor = null;
		this.proxy = null;
		this.#proxyFor = null;
		this.failed = false;
		this.pending = false;
		this.progress = undefined;
		this.size = null;
		this.reason = undefined;
	}

	/** Turn the preview proxy on or off; the preview badge is the entry point. */
	setEnabled(enabled: boolean) {
		const f = this.#opts.file();
		if (!f) return;
		setProxyDisabled(f, !enabled);
		// Cleared, not set: the effect re-reads the choice and decides.
		this.#reset();
		this.disabled = !enabled;
	}

	retry = () => {
		this.#jobFor = null;
		this.failed = false;
		this.reason = undefined;
	};

	#run() {
		if (!this.#opts.active()) return;
		const f = this.#opts.file();
		if (this.#jobFor !== f) {
			// Different media: drop the previous file's proxy and job.
			this.#reset();
			this.disabled = isProxyDisabled(f);
		}
		// The player gates as well as sizes: files on the <video> fallback need no proxy.
		const player = this.#opts.player();
		const w = player?.width ?? 0;
		const h = player?.height ?? 0;
		if (!player || !needsProxy(w, h)) return;
		// The user asked for the original: no job, and the badge says so.
		if (this.disabled) return;
		if (this.#jobFor === f || this.#proxyFor === f || this.failed) return;
		this.#jobFor = f;
		this.pending = true;
		void this.#build(f);
	}

	async #build(f: File) {
		const current = () => f === this.#opts.file();
		const stored = await getSequenceMediaProxy(f);
		let proxy = stored;
		if (!stored) {
			const job = startProxyJob(f, {
				onProgress: (progress) => {
					if (current()) this.progress = progress;
				},
				onSized: (width, height) => {
					if (current()) this.size = { width, height };
				},
				onFailed: (reason) => {
					if (current()) this.reason = reason;
				},
			});
			this.#job = job;
			proxy = await job.promise;
		}
		if (!current()) return;
		// A proxy that won't open is worse than none, so it gets the same decodability check.
		let openedSize: { width: number; height: number } | null = null;
		if (proxy) {
			const opened = await openVideoFrameSource(proxy);
			if (opened) {
				// The finished file's real size; a stored proxy never announced one.
				openedSize = { width: opened.width, height: opened.height };
			}
			opened?.queue.dispose();
			if (!opened) {
				proxy = null;
				// A stored one that no longer opens has to go, or the retry finds it.
				if (stored) void deleteSequenceMediaProxy(f).catch(() => {});
			}
		}
		if (proxy) {
			// Persisted under the file's own id, so re-opening the same video skips the transcode.
			if (!stored) void putSequenceMediaProxy(f, proxy).catch(() => {});
			this.proxy = proxy;
			this.#proxyFor = f;
			this.size = openedSize;
			this.pending = false;
			this.progress = undefined;
		} else {
			// Not auto-retried; a persistent failure would loop.
			this.failed = true;
			this.pending = false;
			this.progress = undefined;
			this.size = null;
			showToast(
				`No smaller copy of "${f.name}" could be made. The preview plays the` +
					" original, which may stutter. Export is unaffected.",
				"error",
				8000,
				{ label: "Try again", run: this.retry },
			);
		}
	}
}
