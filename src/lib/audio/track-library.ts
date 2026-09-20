// src/lib/audio/track-library.ts
import { generateId } from "../effects/types";

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

const DB_NAME = "openmosh-tracks";
const STORE = "tracks";
const DB_VERSION = 1;

function openDb(): Promise<IDBDatabase> {
	return new Promise((resolve, reject) => {
		const req = indexedDB.open(DB_NAME, DB_VERSION);
		req.onupgradeneeded = () => {
			req.result.createObjectStore(STORE, { keyPath: "id" });
		};
		req.onsuccess = () => resolve(req.result);
		req.onerror = () => reject(req.error);
	});
}

export async function getAllTracks(): Promise<StoredTrack[]> {
	const db = await openDb();
	return new Promise((resolve, reject) => {
		const tx = db.transaction(STORE, "readonly");
		const req = tx.objectStore(STORE).getAll();
		let result: StoredTrack[] = [];
		req.onsuccess = () => {
			result = req.result as StoredTrack[];
		};
		tx.oncomplete = () => {
			db.close();
			resolve(result);
		};
		tx.onerror = () => {
			db.close();
			reject(tx.error);
		};
	});
}

export async function getTrack(id: string): Promise<StoredTrack | null> {
	const db = await openDb();
	return new Promise((resolve, reject) => {
		const tx = db.transaction(STORE, "readonly");
		const req = tx.objectStore(STORE).get(id);
		let result: StoredTrack | undefined;
		req.onsuccess = () => {
			result = req.result as StoredTrack | undefined;
		};
		tx.oncomplete = () => {
			db.close();
			resolve(result ?? null);
		};
		tx.onerror = () => {
			db.close();
			reject(tx.error);
		};
	});
}

/**
 * Save the file, or hand back the entry it was already saved as.
 *
 * The lookup runs inside the write transaction on purpose. Two callers can ask
 * to save the same song at once — the editor registering the loaded track and
 * the library drawer auto-saving it — and a lookup done before the transaction
 * misses a write still in flight, so both would store it and the song would
 * show up twice under one name. IndexedDB runs overlapping readwrite
 * transactions on a store one after another, so checking in here means the
 * second caller sees the first caller's track and returns that instead.
 */
export async function addTrack(file: File): Promise<StoredTrack> {
	const db = await openDb();
	return new Promise((resolve, reject) => {
		const tx = db.transaction(STORE, "readwrite");
		const store = tx.objectStore(STORE);
		const existing = store.getAll();
		let track: StoredTrack | undefined;
		existing.onsuccess = () => {
			track = (existing.result as StoredTrack[]).find(
				(t) => trackFileName(t) === file.name && t.blob.size === file.size,
			);
			if (track) return;
			track = {
				id: generateId(),
				name: file.name,
				blob: file,
				addedAt: Date.now(),
			};
			store.put(track);
		};
		tx.oncomplete = () => {
			db.close();
			if (track) resolve(track);
			else reject(new Error("Track lookup never ran"));
		};
		tx.onerror = () => {
			db.close();
			reject(tx.error);
		};
	});
}

/** Give the track a display name; the file name it dedupes by is kept. */
export async function renameTrack(id: string, name: string): Promise<void> {
	const db = await openDb();
	return new Promise((resolve, reject) => {
		const tx = db.transaction(STORE, "readwrite");
		const store = tx.objectStore(STORE);
		const req = store.get(id);
		req.onsuccess = () => {
			const track = req.result as StoredTrack | undefined;
			if (!track) return;
			store.put({ ...track, fileName: trackFileName(track), name });
		};
		tx.oncomplete = () => {
			db.close();
			resolve();
		};
		tx.onerror = () => {
			db.close();
			reject(tx.error);
		};
	});
}

export async function deleteTrack(id: string): Promise<void> {
	const db = await openDb();
	return new Promise((resolve, reject) => {
		const tx = db.transaction(STORE, "readwrite");
		tx.objectStore(STORE).delete(id);
		tx.oncomplete = () => {
			db.close();
			resolve();
		};
		tx.onerror = () => {
			db.close();
			reject(tx.error);
		};
	});
}

/** Every song at once, for the storage manager's "delete everything". */
export async function clearTracks(): Promise<void> {
	const db = await openDb();
	return new Promise((resolve, reject) => {
		const tx = db.transaction(STORE, "readwrite");
		tx.objectStore(STORE).clear();
		tx.oncomplete = () => {
			db.close();
			resolve();
		};
		tx.onerror = () => {
			db.close();
			reject(tx.error);
		};
	});
}
