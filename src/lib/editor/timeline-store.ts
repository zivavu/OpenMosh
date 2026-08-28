/**
 * Per-song timeline persistence, in IndexedDB.
 *
 * Every segment and fx clip carries a full effect chain, so these run to
 * hundreds of kilobytes a song — enough that a few of them filled localStorage's
 * 5 MB cap, after which the writes failed silently. The cost of moving is async
 * reads: see `loadedTimelineKey` in Editor.svelte, which holds off saving until
 * the load for the current key lands.
 */

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

/**
 * Read one song's timeline, falling back to the legacy localStorage blob and
 * copying anything found there into IndexedDB on the way past. The legacy value
 * is left in place, so an older tab still finds its work.
 */
export async function loadTimeline<T>(key: string): Promise<T | null> {
  let stored: unknown = null;
  try {
    stored = await getTimeline(key);
  } catch {
    // Storage blocked or the database is unavailable; the legacy read may
    // still turn something up.
  }
  if (stored != null) return stored as T;

  const legacy = legacyAll()[key];
  if (legacy === undefined) return null;
  if (!migrated.has(key)) {
    migrated.add(key);
    void putTimeline(key, legacy).catch(() => {});
  }
  return legacy as T;
}

/** Returns false when the write couldn't be made, so callers can say so. */
export async function saveTimeline(key: string, state: unknown): Promise<boolean> {
  try {
    await putTimeline(key, state);
    return true;
  } catch {
    return false;
  }
}
