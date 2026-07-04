/** Generic per-track-id localStorage store, keyed by a single storage key holding a Record<trackId, T>. */
export function createTrackStore<T>(
  storageKey: string,
  /** Transform a raw stored entry into T (e.g. for backward-compat with an older format). */
  migrate?: (raw: unknown) => T | null,
) {
  function loadAll(): Record<string, unknown> {
    try {
      return JSON.parse(localStorage.getItem(storageKey) ?? "{}");
    } catch {
      return {};
    }
  }

  function save(trackId: string, data: T) {
    try {
      const all = loadAll();
      all[trackId] = data;
      localStorage.setItem(storageKey, JSON.stringify(all));
    } catch {}
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
