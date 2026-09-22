import { generateId } from "../effects/types";
import { request, simpleStore } from "../idb";

export interface StoredTrack {
	id: string;
	/** What the library shows; the file's name until renamed. */
	name: string;
	/** The name the file came in with, set once the track is renamed. */
	fileName?: string;
	blob: Blob;
	addedAt: number;
}

/** The name a dropped file is matched against, whatever the track is called now. */
export function trackFileName(track: StoredTrack): string {
	return track.fileName ?? track.name;
}

const db = simpleStore("openmosh-tracks", "tracks");

export function getAllTracks(): Promise<StoredTrack[]> {
	return db.getAll<StoredTrack>();
}

export async function getTrack(id: string): Promise<StoredTrack | null> {
	return (await db.get<StoredTrack>(id)) ?? null;
}

/**
 * Save the file, or hand back the entry it was already saved as. The lookup runs
 * inside the write transaction on purpose: two callers can save the same song at
 * once, and a lookup before it misses a write still in flight, storing it twice.
 */
export function addTrack(file: File): Promise<StoredTrack> {
	return db.run("readwrite", async (store) => {
		const existing = await request(store.getAll() as IDBRequest<StoredTrack[]>);
		const found = existing.find(
			(t) => trackFileName(t) === file.name && t.blob.size === file.size,
		);
		if (found) return found;
		const track: StoredTrack = {
			id: generateId(),
			name: file.name,
			blob: file,
			addedAt: Date.now(),
		};
		store.put(track);
		return track;
	});
}

/** Give the track a display name; the dedupe file name is kept, blank reverts. */
export function renameTrack(id: string, name: string): Promise<void> {
	return db.run("readwrite", async (store) => {
		const track = await request(
			store.get(id) as IDBRequest<StoredTrack | undefined>,
		);
		if (!track) return;
		const fileName = trackFileName(track);
		store.put({ ...track, fileName, name: name.trim() || fileName });
	});
}

export function deleteTrack(id: string): Promise<void> {
	return db.delete(id);
}

/** Every song at once, for the storage manager's "delete everything". */
export function clearTracks(): Promise<void> {
	return db.clear();
}
