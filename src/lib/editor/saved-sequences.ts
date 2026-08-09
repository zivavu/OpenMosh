import { getAllTracks } from "../audio/track-library";
import {
  getAllMediaPools,
  getAllSequenceMedia,
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

export async function listSavedSequences(): Promise<SavedSequence[]> {
  let pools, tracks, media;
  try {
    [pools, tracks, media] = await Promise.all([
      getAllMediaPools(),
      getAllTracks(),
      getAllSequenceMedia(),
    ]);
  } catch {
    return [];
  }
  const trackById = new Map(tracks.map((t) => [t.id, t]));
  const stored = new Set(media.map((m) => m.id));

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
  return out.sort((a, b) => b.updatedAt - a.updatedAt);
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
  let pools, tracks, media;
  try {
    [pools, tracks, media] = await Promise.all([
      getAllMediaPools(),
      getAllTracks(),
      getAllSequenceMedia(),
    ]);
  } catch {
    return null;
  }
  const pool = pools.find((p) => p.key === trackId);
  const track = tracks.find((t) => t.id === trackId);
  if (!pool || !track) return null;

  const byId = new Map(media.map((m) => [m.id, m]));
  const sources = pool.sourceIds
    .map((id) => byId.get(id))
    .filter((m) => m !== undefined)
    .map(storedMediaToFile);
  if (sources.length === 0) return null;

  return {
    trackId,
    trackFile: new File([track.blob], track.name, { type: track.blob.type }),
    sources,
  };
}
