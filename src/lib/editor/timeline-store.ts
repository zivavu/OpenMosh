/** Per-song timeline persistence in IndexedDB. Clips carry full chains (hundreds
 * of KB a song), which overflowed localStorage's 5 MB cap and failed silently. */

import { readJson } from "../storage";
import {
	getTimeline,
	putTimeline,
	StaleWriteError,
} from "./sequence-media-store";

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
 * Null only when nothing is saved. A failed read throws even with a legacy copy: that
 * copy can be older than the stored record, and saving it would write over newer work. */
export async function loadTimeline<T>(key: string): Promise<T | null> {
	let stored: unknown = null;
	let readError: unknown = null;
	try {
		stored = await getTimeline(key);
	} catch (err) {
		readError = err;
	}
	if (readError) throw readError;
	if (stored != null) return stored as T;

	const legacy = legacyAll()[key];
	if (legacy === undefined) return null;
	if (!migrated.has(key)) {
		migrated.add(key);
		void putTimeline(key, legacy).catch(() => {});
	}
	return legacy as T;
}

/** Returns false when the write couldn't be made, so callers can say so. Throws
 * StaleWriteError when another tab saved this timeline since. */
export async function saveTimeline(
	key: string,
	state: unknown,
): Promise<boolean> {
	try {
		await putTimeline(key, state);
		return true;
	} catch (err) {
		if (err instanceof StaleWriteError) throw err;
		return false;
	}
}
