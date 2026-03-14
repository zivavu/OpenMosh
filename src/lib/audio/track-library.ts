// src/lib/audio/track-library.ts

export interface StoredTrack {
  id: string;
  name: string;
  blob: Blob;
  addedAt: number;
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

export async function addTrack(file: File): Promise<StoredTrack> {
  const track: StoredTrack = {
    id: crypto.randomUUID(),
    name: file.name,
    blob: file,
    addedAt: Date.now(),
  };
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, "readwrite");
    tx.objectStore(STORE).put(track);
    tx.oncomplete = () => {
      db.close();
      resolve(track);
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
