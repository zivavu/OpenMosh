/**
 * Ask the browser to stop evicting this origin. Everything durable lives in IndexedDB
 * under a best-effort quota a browser short on disk may clear with no warning, taking
 * an afternoon of work with it.
 *
 * Requested on the first write that stores real work rather than at startup: Firefox
 * shows a permission prompt, and one that arrives before the user has made anything is
 * likely to be refused for good. Chrome decides silently on engagement heuristics.
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
