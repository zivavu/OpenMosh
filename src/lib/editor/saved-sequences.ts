import { getAllTracks, getTrack } from "../audio/track-library";
import { createListCache } from "../storage";
import {
  getAllMediaPools,
  getAllSequenceMediaIds,
  getSequenceMediaByIds,
  loadMediaPool,
  storedMediaToFile,
} from "./sequence-media-store";

/**
 * A song you've already built a sequence for, offered on the upload screen so
 * the media doesn't have to be picked again.
 *
 * Pools are keyed the same way the sequence timeline is, which for a
 * video-driven sequence is the video rather than a track — those aren't songs
 * and are skipped here. A pool whose blobs have since been pruned is skipped
 * too: there'd be nothing to open with.
 */
export interface SavedSequence {
  trackId: string;
  trackName: string;
  sourceCount: number;
  updatedAt: number;
}

const CACHE_KEY = "openmosh-saved-sequences";
const cache = createListCache(CACHE_KEY, isSavedSequence);

/**
 * The last computed list, readable synchronously.
 *
 * IndexedDB can only answer a tick or two after mount, so the upload screen
 * would always paint without this section and pop it in afterwards. The cache
 * is a mirror, never the source of truth: `listSavedSequences` still runs and
 * overwrites it, so a song deleted elsewhere corrects itself on the next paint.
 */
export function readCachedSavedSequences(): SavedSequence[] {
  return cache.read();
}

function isSavedSequence(value: unknown): value is SavedSequence {
  const s = value as SavedSequence | null;
  return (
    !!s &&
    typeof s.trackId === "string" &&
    typeof s.trackName === "string" &&
    typeof s.sourceCount === "number" &&
    typeof s.updatedAt === "number"
  );
}

function writeCachedSavedSequences(list: SavedSequence[]): void {
  cache.write(list);
}

export async function listSavedSequences(): Promise<SavedSequence[]> {
  let pools, tracks, stored;
  try {
    // Ids, not records: this only counts which sources survive, and the media
    // store holds every image and video the sequences were built from.
    [pools, tracks, stored] = await Promise.all([
      getAllMediaPools(),
      getAllTracks(),
      getAllSequenceMediaIds(),
    ]);
  } catch {
    // Keep showing what was cached rather than blanking the section on a
    // transient database failure.
    return readCachedSavedSequences();
  }
  const trackById = new Map(tracks.map((t) => [t.id, t]));

  const out: SavedSequence[] = [];
  for (const pool of pools) {
    const track = trackById.get(pool.key);
    if (!track) continue;
    const sourceCount = pool.sourceIds.filter((id) => stored.has(id)).length;
    if (sourceCount === 0) continue;
    out.push({
      trackId: pool.key,
      trackName: track.name,
      sourceCount,
      updatedAt: pool.updatedAt,
    });
  }
  out.sort((a, b) => b.updatedAt - a.updatedAt);
  writeCachedSavedSequences(out);
  return out;
}

/** The song and its media, ready to hand to the editor. */
export interface OpenedSequence {
  trackId: string;
  trackFile: File;
  /** Pool order; the first becomes the editor's primary source. */
  sources: File[];
}

export async function openSavedSequence(
  trackId: string,
): Promise<OpenedSequence | null> {
  let sourceIds, track;
  try {
    // Only this song's pool and track, rather than every pool and every track.
    [sourceIds, track] = await Promise.all([
      loadMediaPool(trackId),
      getTrack(trackId),
    ]);
  } catch {
    return null;
  }
  if (!sourceIds || !track) return null;

  let sources: File[];
  try {
    sources = (await getSequenceMediaByIds(sourceIds)).map(storedMediaToFile);
  } catch {
    return null;
  }
  if (sources.length === 0) return null;

  return {
    trackId,
    trackFile: new File([track.blob], track.name, { type: track.blob.type }),
    sources,
  };
}
