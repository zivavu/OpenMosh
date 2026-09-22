import { getAllTracks, getTrack } from "../audio/track-library";
import { createListCache } from "../storage";
import {
	getAllMediaPools,
	getAllSequenceMediaIds,
	getSequenceMediaByIds,
	loadMediaPool,
	storedMediaToFile,
} from "./sequence-media-store";

/** A song with a saved sequence, offered on the upload screen. Video-driven pools
 * (keyed by video, not track) and pools whose blobs were pruned are skipped. */
export interface SavedSequence {
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
