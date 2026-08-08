/**
 * IndexedDB pool of the media sequence segments draw from.
 *
 * Segments reference sources by id, and a reload hands the editor plain
 * `File`s again — so the ids have to survive it. They're derived from the
 * file's identity rather than generated, which makes re-picking the same file
 * resolve the same saved segments and makes re-adding it a no-op.
 */

export interface StoredSequenceMedia {
  id: string;
  name: string;
  blob: Blob;
  type: string;
  addedAt: number;
}

const DB_NAME = "openmosh-sequence-media";
const STORE = "media";
const DB_VERSION = 1;
/** Oldest entries beyond this are dropped, so the pool can't grow forever. */
const MAX_ENTRIES = 48;

/**
 * Stable across reloads for the same file, without hashing its contents.
 * The name is percent-encoded rather than stripped so two different names
 * can't collapse onto one id (and can't be crafted to forge another's).
 */
export function stableSourceId(file: File): string {
  return `src:${encodeURIComponent(file.name)}:${file.size}:${file.lastModified}`;
}

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

export async function getAllSequenceMedia(): Promise<StoredSequenceMedia[]> {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, "readonly");
    const req = tx.objectStore(STORE).getAll();
    let result: StoredSequenceMedia[] = [];
    req.onsuccess = () => {
      result = req.result as StoredSequenceMedia[];
    };
    tx.oncomplete = () => {
      db.close();
      result.sort((a, b) => a.addedAt - b.addedAt);
      resolve(result);
    };
    tx.onerror = () => {
      db.close();
      reject(tx.error);
    };
  });
}

export async function putSequenceMedia(id: string, file: File): Promise<void> {
  const entry: StoredSequenceMedia = {
    id,
    name: file.name,
    blob: file,
    type: file.type,
    addedAt: Date.now(),
  };
  const db = await openDb();
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction(STORE, "readwrite");
    tx.objectStore(STORE).put(entry);
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

export async function deleteSequenceMedia(id: string): Promise<void> {
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

/** Drops the oldest entries past MAX_ENTRIES. */
export async function pruneSequenceMedia(): Promise<void> {
  const all = await getAllSequenceMedia();
  const excess = all.length - MAX_ENTRIES;
  if (excess <= 0) return;
  for (const entry of all.slice(0, excess)) {
    await deleteSequenceMedia(entry.id);
  }
}

/** Rebuilds a `File` from a stored entry so it can re-enter the pool. */
export function storedMediaToFile(entry: StoredSequenceMedia): File {
  return new File([entry.blob], entry.name, {
    type: entry.type || entry.blob.type,
  });
}
