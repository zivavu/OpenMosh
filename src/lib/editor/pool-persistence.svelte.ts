/** The editor's pool in storage: the opened files going in, the pool saved under the
 * project's key and read back for it, and media its clips name that isn't loaded yet.
 * Runs effects, so construct during component init. */

import { untrack } from "svelte";
import { mediaTimelineSourceIds, type MediaTimeline } from "../media";
import type { SaveTracker } from "./save-status.svelte";
import {
	loadMediaPool,
	loadMediaPoolSlides,
	pruneSequenceMediaThrottled,
	saveMediaPool,
} from "./sequence-media-store";
import type { SequenceSourceRegistry } from "./sequence-sources.svelte";
import type { TimelinePersistence } from "./timeline-persistence.svelte";

export interface PoolPersistenceHost {
	/** Editor mode; single mode has no pool to keep. */
	active: boolean;
	registry: SequenceSourceRegistry;
	/** The project key the pool is saved under, as the timeline is. */
	baseKey(): string | null;
	/** Store-key prefix, for the timeline's held keys. */
	prefix: string;
	timelines: TimelinePersistence;
	saves: SaveTracker;
	slideOnlyIds(): ReadonlySet<string>;
	setSlideOnlyIds(ids: ReadonlySet<string>): void;
	mediaTimeline(): MediaTimeline;
	/** A song is loaded; until it has a key, the pool isn't settled. */
	hasSong(): boolean;
}

export class PoolPersistence {
	readonly #host: PoolPersistenceHost;
	#key: string | null = null;
	#saveTimer: ReturnType<typeof setTimeout> | undefined;
	#savePending = false;
	/** Clip source ids already looked for in storage. */
	readonly #restoreAttempted = new Set<string>();

	/** The pool is empty until the opening file lands, so the placeholder waits for that. */
	filled = $state(false);
	/** Held from mount until the opening files are in the pool; proxies are not waited on. */
	#opening = $state(true);
	/** The mount-time adds (the opened file and its extras) have finished. */
	openDone = $state(false);
	ready = $state(false);

	/** Opened, and nothing in it. */
	empty = $derived.by(
		() =>
			this.#host.active &&
			this.filled &&
			this.#host.registry.sources.length === 0,
	);
	/** Media is being probed and nothing has landed, so the canvas is black. */
	loading = $derived.by(() => {
		const { active, registry } = this.#host;
		return (
			active &&
			(this.#opening ||
				(registry.loadingTotal > 0 && registry.sources.length === 0))
		);
	});

	constructor(host: PoolPersistenceHost) {
		this.#host = host;
		$effect(() => this.#settleOpening());
		$effect(() => this.#loadForKey());
		$effect(() => this.#scheduleSave());
		$effect(() => this.#restoreMissing());
	}

	/** The files the editor was opened with go in first, then its extras. */
	async open(
		file: File | null,
		extras: File[],
		persist: boolean,
		explainRejected: (files: File[]) => unknown,
	) {
		if (!this.#host.active) return;
		const { registry } = this.#host;
		try {
			// A project whose pool was emptied opens with no file at all.
			const opened = file ? [file] : [];
			if (opened.length > 0) await registry.add(opened, { persist });
			this.filled = true;
			const rest = extras.filter((f) => f !== file);
			if (rest.length > 0) await registry.add(rest, { persist });
			void explainRejected([...opened, ...rest]);
		} finally {
			this.openDone = true;
		}
	}

	/** Look for every missing source again, as after a song switch. */
	forgetRestoreAttempts() {
		this.#restoreAttempted.clear();
	}

	#settleOpening() {
		if (!this.#opening) return;
		const { registry } = this.#host;
		const key = this.#host.baseKey();
		// A song being registered has no key yet, so the key is settled once there is one.
		const keySettled = !!key || !this.#host.hasSong();
		const settled =
			this.openDone &&
			keySettled &&
			(this.ready || !key) &&
			registry.loadingTotal === 0 &&
			!registry.sources.some((s) => s.thumbPending);
		if (settled) this.#opening = false;
	}

	#loadForKey() {
		const host = this.#host;
		if (!host.active) return;
		const key = host.baseKey();
		if (!key || key === this.#key) return;
		this.#key = key;
		this.ready = false;
		// A different song may reference media this session hasn't tried yet.
		this.#restoreAttempted.clear();
		void (async () => {
			try {
				const ids = await loadMediaPool(key);
				const slides = ids ? await loadMediaPoolSlides(key) : [];
				if (this.#key !== key) return;
				if (ids) host.setSlideOnlyIds(new Set(slides));
				// A song with a saved pool swaps to it; one with none keeps what's loaded.
				if (ids) await host.registry.setPool(ids);
			} catch {
				// Saving what did load would drop the rest from the project.
				if (this.#key === key)
					host.timelines.hold(host.prefix + key, "unreadable");
			}
			if (this.#key === key) this.ready = true;
		})();
	}

	// Debounced: a multi-file add appends in batches.
	#scheduleSave() {
		const host = this.#host;
		if (!host.active || !this.ready) return;
		const key = this.#key;
		const ids = host.registry.sources.map((s) => s.id);
		host.slideOnlyIds();
		if (!key) return;
		clearTimeout(this.#saveTimer);
		untrack(() => host.saves.schedule("pool"));
		this.#savePending = true;
		this.#saveTimer = setTimeout(() => this.#save(key, ids), 400);
	}

	#save(key: string, ids: string[]) {
		const host = this.#host;
		this.#savePending = false;
		// Held (newer or unreadable): nothing of it is written, as the toast promised.
		if (host.timelines.isHeld(host.prefix + key)) {
			host.saves.drop("pool");
			return;
		}
		void host.saves
			.track(
				"pool",
				host.timelines.holdIfStale(
					host.prefix + key,
					saveMediaPool(key, ids, [...host.slideOnlyIds()]).then(() => true),
				),
			)
			.then((ok) => {
				if (ok) void pruneSequenceMediaThrottled().catch(() => {});
			});
	}

	/** Write now; same key-switch race as the timeline's flush. */
	flush() {
		const host = this.#host;
		clearTimeout(this.#saveTimer);
		if (!this.#savePending) return;
		if (!host.active || !this.ready || !this.#key) {
			host.saves.drop("pool");
			return;
		}
		this.#save(
			this.#key,
			host.registry.sources.map((s) => s.id),
		);
	}

	// A restored timeline references sources by id; pull missing ones back out of storage.
	#restoreMissing() {
		const { active, registry } = this.#host;
		if (!active) return;
		const missing = [
			...mediaTimelineSourceIds(this.#host.mediaTimeline()),
			...registry.sources.flatMap((s) => s.cutList?.slides ?? []),
		].filter((id) => !registry.get(id) && !this.#restoreAttempted.has(id));
		if (missing.length === 0) return;
		for (const id of missing) this.#restoreAttempted.add(id);
		void registry.restore(missing).catch(() => {});
	}
}
