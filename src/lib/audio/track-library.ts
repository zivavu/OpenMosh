import { generateId } from "../effects/types";
import { request, simpleStore } from "../idb";
import { sameBytes } from "../utils";

export interface StoredTrack {
	id: string;
	/** What the library shows; the file's name until renamed. */
	name: string;
	/** The name the file came in with, set once the track is renamed. */
	fileName?: string;
	blob: Blob;
	addedAt: number;
	/** A mic take recorded in the editor: kept off the library's list, and deleted
	 * with the last project that plays it. */
	take?: true;
}

/** The name a dropped file is matched against, whatever the track is called now. */
export function trackFileName(track: StoredTrack): string {
	return track.fileName ?? track.name;
}

/** The stored song as a File. Stamped with when it was added, so every rebuild of
 * one track reads as the same file to the decode cache. */
export function trackToFile(track: StoredTrack): File {
	return new File([track.blob], track.name, {
		type: track.blob.type,
		lastModified: track.addedAt,
	});
}

const db = simpleStore("openmosh-tracks", "tracks");

export function getAllTracks(): Promise<StoredTrack[]> {
	return db.getAll<StoredTrack>();
}

/** Just the ids, for checking what a song-keyed record still points at. */
export async function getAllTrackIds(): Promise<Set<string>> {
	const keys = await db.run("readonly", (s) => request(s.getAllKeys()));
	return new Set(keys.map(String));
}

export async function getTrack(id: string): Promise<StoredTrack | null> {
	return (await db.get<StoredTrack>(id)) ?? null;
}

/**
 * Save the file, or hand back the entry it was already saved as. The lookup runs
 * inside the write transaction on purpose: two callers can save the same song at
 * once, and a lookup before it misses a write still in flight, storing it twice.
 */
export async function addTrack(
	file: File,
	{ take = false } = {},
): Promise<StoredTrack> {
	const different = new Set<string>();
	for (;;) {
		const { track, isNew } = await findOrSave(file, different, take);
		if (isNew) return track;
		// Name and size can match a different song. Its bytes are read out here, since an
		// await on anything but the store would end the write transaction.
		if (await sameBytes(track.blob, file)) return track;
		different.add(track.id);
	}
}

/** The stored song matching by name and size (`different` aside), else the file saved. */
function findOrSave(
	file: File,
	different: Set<string>,
	take: boolean,
): Promise<{ track: StoredTrack; isNew: boolean }> {
	return db.run("readwrite", async (store) => {
		const existing = await request(store.getAll() as IDBRequest<StoredTrack[]>);
		const found = existing.find(
			(t) =>
				trackFileName(t) === file.name &&
				t.blob.size === file.size &&
				!different.has(t.id),
		);
		if (found) return { track: found, isNew: false };
		const track: StoredTrack = {
			id: generateId(),
			name: file.name,
			blob: file,
			addedAt: Date.now(),
			...(take ? { take: true as const } : {}),
		};
		store.put(track);
		return { track, isNew: true };
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

/** Songs from a backup, under the ids their projects point at. */
export function putTracks(tracks: StoredTrack[]): Promise<void> {
	return db.run("readwrite", (store) => {
		for (const track of tracks) store.put(track);
	});
}

export function deleteTrack(id: string): Promise<void> {
	return db.delete(id);
}

/** Every song at once, for the storage manager's "delete everything". */
export function clearTracks(): Promise<void> {
	return db.clear();
}
