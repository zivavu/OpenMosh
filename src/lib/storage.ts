/**
 * localStorage access that can't throw.
 *
 * Every read has to survive a half-written or hand-edited value, and every
 * write has to survive a private window and a full quota — a persistence
 * failure is never worth taking the UI down with it. That was a try/catch at
 * each of the three dozen call sites, which is how one of them (updateSettings)
 * ended up without one.
 */

/** The stored value at `key`, or `fallback` when it's missing or unparseable. */
export function readJson<T>(key: string, fallback: T): T {
  try {
    const raw = localStorage.getItem(key);
    if (raw === null) return fallback;
    return JSON.parse(raw) as T;
  } catch {
    return fallback;
  }
}

/** Store `value` as JSON. Returns false when it couldn't be written. */
export function writeJson(key: string, value: unknown): boolean {
  try {
    localStorage.setItem(key, JSON.stringify(value));
    return true;
  } catch {
    return false;
  }
}

export function readRaw(key: string): string | null {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}

export function writeRaw(key: string, value: string): boolean {
  try {
    localStorage.setItem(key, value);
    return true;
  } catch {
    return false;
  }
}

/**
 * A localStorage mirror of a list that really lives in IndexedDB.
 *
 * IndexedDB can only answer a tick or two after mount, so a section driven by
 * it would always paint empty and pop in afterwards. The mirror is never the
 * source of truth: the async load still runs and overwrites it, so an entry
 * deleted elsewhere corrects itself on the next paint. Entries are validated on
 * read, since anything could be sitting under the key.
 */
export function createListCache<T>(
  key: string,
  isValid: (value: unknown) => value is T,
) {
  return {
    read(): T[] {
      const parsed = readJson<unknown>(key, null);
      return Array.isArray(parsed) ? parsed.filter(isValid) : [];
    },
    write(list: T[]): void {
      writeJson(key, list);
    },
  };
}
