/** Per-song timeline persistence in IndexedDB. Clips carry full chains (hundreds
 * of KB a song), which overflowed localStorage's 5 MB cap and failed silently. */

import { readJson } from "../storage";
import { getTimeline, putTimeline } from "./sequence-media-store";

/** Where every song's timeline used to live, all in one value. */
const LEGACY_KEY = "openmosh-sequence";

/** Entries copied out of localStorage already, so a reload doesn't redo it. */
const migrated = new Set<string>();

function legacyAll(): Record<string, unknown> {
	const all = readJson<Record<string, unknown>>(LEGACY_KEY, {});
	return all && typeof all === "object" ? all : {};
}

/** Read one song's timeline, falling back to the legacy localStorage blob and
 * copying it into IndexedDB; the legacy value stays so an older tab still finds it.
 * Null only when nothing is saved: a failed read throws, or the caller would take the
 * project for a new one and save its blank state over the real one. */
export async function loadTimeline<T>(key: string): Promise<T | null> {
	let stored: unknown = null;
	let readError: unknown = null;
	try {
		stored = await getTimeline(key);
	} catch (err) {
		readError = err;
	}
	if (stored != null) return stored as T;

	const legacy = legacyAll()[key];
	if (legacy === undefined) {
		if (readError) throw readError;
		return null;
	}
	if (!migrated.has(key)) {
		migrated.add(key);
		void putTimeline(key, legacy).catch(() => {});
	}
	return legacy as T;
}

/** Returns false when the write couldn't be made, so callers can say so. */
export async function saveTimeline(
	key: string,
	state: unknown,
): Promise<boolean> {
	try {
		await putTimeline(key, state);
		return true;
	} catch {
		return false;
	}
}
