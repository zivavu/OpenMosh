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
   * Write one song's entry. Returns false only when even that entry alone
   * doesn't fit.
   *
   * Every song this store has ever held lives under one localStorage key, and
   * nothing ever removed an entry — so the blob only grew. A sequence timeline
   * is not small (every segment and every fx clip carries a full effect chain),
   * and past a handful of songs the write started throwing on quota. That threw
   * inside writeJson, which swallows it, so the app went on looking fine and
   * quietly stopped persisting anything: the work was still on screen, and gone
   * on the next reload.
   *
   * So a failed write now evicts, oldest first, and retries. Losing the
   * timeline for a song that isn't open beats never again saving the one that
   * is. The current entry is re-inserted at the end on every save, which makes
   * the key order least-recently-saved first and the eviction order an LRU.
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
