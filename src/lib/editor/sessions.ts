/** Resumable edits for single and slideshow mode, keyed by the song when there is one. */

import { getAllTracks, getTrack } from "../audio/track-library";
import { createListCache } from "../storage";
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

/** What single mode stores; older sessions may carry a `media` block, now ignored. */
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

/** What identifies a resumable edit: the song whenever there is one. */
function sessionKey(
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

/** Store the media and editor state under this session's key. */
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
	// A song-keyed session is named after the song, matching the sequence list.
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

	// The song comes back with the media, or lanes restore keyed to an unloaded track.
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
	let sessions, tracks;
	try {
		[sessions, tracks] = await Promise.all([getAllSessions(), getAllTracks()]);
	} catch {
		// A transient failure shouldn't blank the section.
		return readCachedSessions(mode);
	}
	// The stored label is the song's name at last save; a renamed song should read as elsewhere.
	const trackName = new Map(tracks.map((t) => [t.id, t.name]));
	const out = sessions
		.filter((s) => s.mode === mode)
		// Song-less slideshow entries predate the track requirement; the next prune deletes them.
		.filter((s) => s.mode !== "slideshow" || !!s.trackId)
		.map((s) => ({
			key: s.key,
			mode: s.mode,
			label: (s.trackId && trackName.get(s.trackId)) || s.label,
			sourceCount: s.sourceIds.length,
			updatedAt: s.updatedAt,
		}))
		.sort((a, b) => b.updatedAt - a.updatedAt);
	writeCache(mode, out);
	return out;
}

const cacheKey = (mode: SessionMode) => `openmosh-saved-sessions:${mode}`;

const cacheFor = (mode: SessionMode) =>
	createListCache(cacheKey(mode), isSavedSession);

/** Synchronous, so the upload screen can paint the list on its first render. */
export function readCachedSessions(mode: SessionMode): SavedSession[] {
	return cacheFor(mode).read();
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
	cacheFor(mode).write(list);
}
