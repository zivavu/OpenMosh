/**
 * Ask the browser to stop evicting this origin.
 *
 * Everything durable — sessions, timelines, the media pool, proxies — lives in
 * IndexedDB under a best-effort quota, which a browser short on disk may clear
 * with no warning and no undo. An afternoon of timeline work goes with it.
 * Persistent storage exempts the origin from that sweep.
 *
 * Requested on the first write that stores real work rather than at startup:
 * Firefox shows a permission prompt, and a prompt that arrives before the user
 * has made anything is both unexplainable and likely to be refused for good.
 * Chrome grants or refuses it silently on engagement heuristics, so a refusal
 * there is worth re-asking after a later visit — hence once per page load, not
 * once ever.
 */

let pending: Promise<boolean> | null = null;

/** Idempotent per page load. Never rejects; false means "still evictable". */
export function requestPersistentStorage(): Promise<boolean> {
  return (pending ??= run());
}

async function run(): Promise<boolean> {
  try {
    // Absent on older Safari, and on any non-secure context.
    if (!navigator.storage?.persist) return false;
    if (await navigator.storage.persisted()) return true;
    return await navigator.storage.persist();
  } catch {
    return false;
  }
}
