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
