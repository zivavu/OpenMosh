import { getAllTracks, getTrack } from "../audio/track-library";
import { createListCache } from "../storage";
import { readProjectNames } from "./project-names";
import {
	getAllMediaPools,
	getAllSequenceMediaIds,
	getSequenceMediaByIds,
	loadMediaPool,
	storedMediaToFile,
} from "./sequence-media-store";

/** A saved editor project, offered on the upload screen: one keyed by its song, or,
 * since projects got their own length, by an id of its own. Video-driven pools and
 * pools whose blobs were pruned are skipped. */
export interface SavedSequence {
	/** The project key: a track id for song-keyed projects, else a `proj-` id. */
	trackId: string;
	trackName: string;
	sourceCount: number;
	updatedAt: number;
}

const CACHE_KEY = "openmosh-saved-sequences";
const cache = createListCache(CACHE_KEY, isSavedSequence);

/** Last computed list, readable synchronously so the upload screen paints with it.
 * A mirror only: `listSavedSequences` still runs and overwrites it. */
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
		// Ids, not records: this only counts which sources survive.
		[pools, tracks, stored] = await Promise.all([
			getAllMediaPools(),
			getAllTracks(),
			getAllSequenceMediaIds(),
		]);
	} catch {
		// Fall back to the cache rather than blanking the section on a transient DB failure.
		return readCachedSavedSequences();
	}
	const trackById = new Map(tracks.map((t) => [t.id, t]));
	const names = readProjectNames();

	const out: SavedSequence[] = [];
	for (const pool of pools) {
		const track = trackById.get(pool.key);
		const own = isProjectKey(pool.key);
		if (!track && !own) continue;
		const sourceCount = pool.sourceIds.filter((id) => stored.has(id)).length;
		if (sourceCount === 0) continue;
		out.push({
			trackId: pool.key,
			trackName: track?.name ?? names[pool.key] ?? "Untitled project",
			sourceCount,
			updatedAt: pool.updatedAt,
		});
	}
	out.sort((a, b) => b.updatedAt - a.updatedAt);
	writeCachedSavedSequences(out);
	return out;
}

/** A project keyed by its own id rather than a song's. */
export function isProjectKey(key: string): boolean {
	return key.startsWith("proj-");
}

/** The project's media, and its song when it's keyed by one, ready for the editor. */
export interface OpenedSequence {
	/** The project key. */
	trackId: string;
	/** Null for a project keyed by its own id: its song, if any, is in its timeline. */
	trackFile: File | null;
	/** Pool order; the first becomes the editor's primary source. */
	sources: File[];
}

export async function openSavedSequence(
	trackId: string,
): Promise<OpenedSequence | null> {
	let sourceIds, track;
	try {
		[sourceIds, track] = await Promise.all([
			loadMediaPool(trackId),
			isProjectKey(trackId) ? null : getTrack(trackId),
		]);
	} catch {
		return null;
	}
	if (!sourceIds || (!track && !isProjectKey(trackId))) return null;

	let sources: File[];
	try {
		sources = (await getSequenceMediaByIds(sourceIds)).map(storedMediaToFile);
	} catch {
		return null;
	}
	if (sources.length === 0) return null;

	return {
		trackId,
		trackFile: track
			? new File([track.blob], track.name, { type: track.blob.type })
			: null,
		sources,
	};
}
