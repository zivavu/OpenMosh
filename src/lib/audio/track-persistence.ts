import { readJson, writeJson } from "../storage";

/** Generic per-track-id localStorage store, keyed by a single storage key holding a Record<trackId, T>. */
export function createTrackStore<T>(
	storageKey: string,
	/** Transform a raw stored entry into T (e.g. for backward-compat with an older format). */
	migrate?: (raw: unknown) => T | null,
) {
	function loadAll(): Record<string, unknown> {
		const all = readJson<Record<string, unknown>>(storageKey, {});
		return all && typeof all === "object" ? all : {};
	}

	/**
	 * Write one song's entry, evicting older ones if the quota is hit. Without
	 * this a full blob threw inside writeJson, which swallows it, and the store
	 * silently stopped saving. Re-inserting the current key makes the order an LRU.
	 * Returns false only when even one entry alone doesn't fit.
	 */
	function save(trackId: string, data: T): boolean {
		const all = loadAll();
		delete all[trackId];
		all[trackId] = data;
		if (writeJson(storageKey, all)) return true;
		for (const key of Object.keys(all)) {
			if (key === trackId) continue;
			delete all[key];
			if (writeJson(storageKey, all)) return true;
		}
		return false;
	}

	function load(trackId: string): T | null {
		try {
			const entry = loadAll()[trackId];
			if (entry === undefined) return null;
			return migrate ? migrate(entry) : (entry as T);
		} catch {}
		return null;
	}

	return { save, load };
}

/**
 * Every per-song localStorage key, so a song deleted from the storage manager
 * takes its span, segments and render settings with it. Render settings are
 * keyed by the mode-prefixed timeline key rather than the bare track id; the
 * legacy timeline blob is keyed both ways, from before the prefix existed.
 */
const TRACK_KEYED_STORES = [
	"openmosh-single-span",
	"openmosh-single-size",
	"openmosh-track-segments",
	"openmosh-render-settings",
	"openmosh-sequence",
];

/** Drop the entries stored under any of these ids, in every per-song store. */
export function forgetTrackEntries(ids: string[]): void {
	const wanted = new Set(ids);
	for (const storageKey of TRACK_KEYED_STORES) {
		const all = readJson<Record<string, unknown>>(storageKey, {});
		if (!all || typeof all !== "object") continue;
		let changed = false;
		for (const key of Object.keys(all)) {
			if (wanted.has(key)) {
				delete all[key];
				changed = true;
			}
		}
		if (changed) writeJson(storageKey, all);
	}
}

/** Empty every per-song store. */
export function forgetAllTrackEntries(): void {
	for (const storageKey of TRACK_KEYED_STORES) writeJson(storageKey, {});
}
