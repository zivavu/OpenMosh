/**
 * Resumable edits for single and slideshow mode.
 *
 * Keyed the way sequence mode keys its media pool: by the song when there is
 * one, falling back to the media itself when there isn't. That matters because
 * the rest of a mode's per-song work — the text timeline, segments, BPM, the
 * playback span — is already stored against the track id. Keying the media any
 * other way would split one edit across two identities, and reopening a song
 * would restore its text over somebody else's images.
 *
 * Both the media and the editor state live in IndexedDB, but the list shown on
 * the upload screen is mirrored into localStorage — IndexedDB can only answer
 * asynchronously, and the section has to be there on the first paint or the
 * layout jumps when it arrives.
 */

import { getTrack } from "../audio/track-library";
import {
  getAllSessions,
  getSequenceMediaByIds,
  getSession,
  putSequenceMedia,
  putSession,
  stableSourceId,
  storedMediaToFile,
  type SessionMode,
} from "./sequence-media-store";

import type { EffectInstance } from "../effects/types";
import type { TextTimeline } from "../text/types";

/** What single mode stores; sequence keeps its own timeline entry instead. */
export interface SingleSessionState {
  effects: EffectInstance[];
  text: TextTimeline | null;
}

export interface SavedSession {
  key: string;
  mode: SessionMode;
  label: string;
  sourceCount: number;
  updatedAt: number;
}

/**
 * What identifies a resumable edit.
 *
 * The song, whenever there is one: that's what the text timeline and segments
 * are already stored under.
 *
 * Slideshow has no fallback. The upload screen requires a track before it will
 * start one, so a song-less slideshow can't be created — and keying it by its
 * media instead meant every image added or removed forked a whole new session,
 * leaving a trail of them behind one editing pass.
 *
 * Single mode does fall back to its one file, because it genuinely works with
 * no audio at all, and one file is a stable identity in a way a set isn't.
 */
export function sessionKey(
  mode: SessionMode,
  files: File[],
  trackId?: string | null,
): string | null {
  if (trackId) return `${mode}:track:${trackId}`;
  if (mode === "slideshow") return null;
  if (files.length === 0) return null;
  return `single:${stableSourceId(files[0])}`;
}

function defaultLabel(mode: SessionMode, files: File[]): string {
  if (mode === "single") return files[0]?.name ?? "Untitled";
  return `${files.length} image${files.length === 1 ? "" : "s"}`;
}

/**
 * Store the media and the editor state under this session's key.
 *
 * Media is written every time rather than diffed: ids are content-derived, so
 * re-putting a file that's already there overwrites it with itself.
 */
export async function saveSession(
  mode: SessionMode,
  files: File[],
  state: unknown,
  trackId?: string | null,
): Promise<void> {
  const key = sessionKey(mode, files, trackId);
  if (!key) return;
  const entries = files.map((file) => ({ id: stableSourceId(file), file }));
  await putSequenceMedia(entries);
  // A song-keyed session is named after the song, matching how the sequence
  // list reads; the media only names it when there's no song to name it after.
  let label = defaultLabel(mode, files);
  if (trackId) {
    const track = await getTrack(trackId).catch(() => null);
    if (track) label = track.name;
  }
  await putSession({
    key,
    mode,
    label,
    trackId: trackId ?? undefined,
    sourceIds: entries.map((e) => e.id),
    state,
  });
  // Refresh the mirror so the upload screen paints this edit next time.
  await listSavedSessions(mode).catch(() => {});
}

export interface OpenedSession {
  key: string;
  files: File[];
  state: unknown;
  /** The song this edit was built against, when it was keyed by one. */
  trackId: string | null;
  trackFile: File | null;
}

/** Null when the session is gone, or its media has since been pruned. */
export async function openSession(key: string): Promise<OpenedSession | null> {
  let session;
  try {
    session = await getSession(key);
  } catch {
    return null;
  }
  if (!session) return null;

  let files: File[];
  try {
    files = (await getSequenceMediaByIds(session.sourceIds)).map(
      storedMediaToFile,
    );
  } catch {
    return null;
  }
  if (files.length === 0) return null;

  // The song comes back with the media: without it the editor would restore a
  // text timeline and segments keyed to a track that isn't loaded.
  let trackFile: File | null = null;
  if (session.trackId) {
    const track = await getTrack(session.trackId).catch(() => null);
    if (track) {
      trackFile = new File([track.blob], track.name, { type: track.blob.type });
    }
  }
  return {
    key,
    files,
    state: session.state,
    trackId: session.trackId ?? null,
    trackFile,
  };
}

export async function listSavedSessions(
  mode: SessionMode,
): Promise<SavedSession[]> {
  let sessions;
  try {
    sessions = await getAllSessions();
  } catch {
    // A transient failure shouldn't blank the section.
    return readCachedSessions(mode);
  }
  const out = sessions
    .filter((s) => s.mode === mode)
    // Song-less slideshow entries predate the track requirement. They're
    // deleted on the next prune; hiding them now keeps the list from showing
    // one near-duplicate per image that was ever added or removed.
    .filter((s) => s.mode !== "slideshow" || !!s.trackId)
    .map((s) => ({
      key: s.key,
      mode: s.mode,
      label: s.label,
      sourceCount: s.sourceIds.length,
      updatedAt: s.updatedAt,
    }))
    .sort((a, b) => b.updatedAt - a.updatedAt);
  writeCache(mode, out);
  return out;
}

const cacheKey = (mode: SessionMode) => `openmosh-saved-sessions:${mode}`;

/** Synchronous, so the upload screen can paint the list on its first render. */
export function readCachedSessions(mode: SessionMode): SavedSession[] {
  try {
    const parsed: unknown = JSON.parse(
      localStorage.getItem(cacheKey(mode)) ?? "",
    );
    return Array.isArray(parsed) ? parsed.filter(isSavedSession) : [];
  } catch {
    return [];
  }
}

function isSavedSession(value: unknown): value is SavedSession {
  const s = value as SavedSession | null;
  return (
    !!s &&
    typeof s.key === "string" &&
    typeof s.label === "string" &&
    typeof s.sourceCount === "number" &&
    typeof s.updatedAt === "number"
  );
}

function writeCache(mode: SessionMode, list: SavedSession[]): void {
  try {
    localStorage.setItem(cacheKey(mode), JSON.stringify(list));
  } catch {
    // Quota or a private window; the list still loads, just not instantly.
  }
}
