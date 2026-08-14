/**
 * IndexedDB storage for sequence media.
 *
 * Two stores. `media` holds the blobs, keyed by a content-derived id: a reload
 * hands the editor plain `File`s again, so the ids have to survive it, which
 * also makes re-adding the same file a no-op. `pools` records which of those
 * ids belong to which song, so loading a track brings back the media that
 * song's timeline was built from rather than one global bin.
 *
 * The pool key matches the sequence timeline's own storage key (the track id,
 * or the source video when there's no track), so the two always swap together.
 */

export interface StoredSequenceMedia {
  id: string;
  name: string;
  blob: Blob;
  type: string;
  addedAt: number;
  /**
   * The source file's mtime. Part of the id, so rebuilding a File without it
   * changes that File's id — see storedMediaToFile. Absent on records written
   * before this field existed.
   */
  lastModified?: number;
}

/** The set of media one song's timeline draws from. */
export interface StoredMediaPool {
  key: string;
  sourceIds: string[];
  updatedAt: number;
}

const DB_NAME = "openmosh-sequence-media";
const STORE = "media";
const POOL_STORE = "pools";
const DB_VERSION = 2;
/** Least recently used pools past this are dropped. */
const MAX_POOLS = 20;
/**
 * Media belonging to no retained pool is kept up to this many entries, newest
 * first. Freshly added files land here until the pool save catches up, so this
 * must not be so tight that an add races its own eviction.
 */
const MAX_UNREFERENCED = 64;

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
    // Guarded rather than unconditional: v1 databases already have `media`,
    // and upgrading them must only add the store they're missing.
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE)) {
        db.createObjectStore(STORE, { keyPath: "id" });
      }
      if (!db.objectStoreNames.contains(POOL_STORE)) {
        db.createObjectStore(POOL_STORE, { keyPath: "key" });
      }
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

/**
 * Just the ids, without deserializing a blob per record. Callers that only need
 * to know what's stored (rather than read it) should use this: the media store
 * holds every image and video, so a full getAll there is the most expensive
 * read in the app.
 */
export async function getAllSequenceMediaIds(): Promise<Set<string>> {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, "readonly");
    const req = tx.objectStore(STORE).getAllKeys();
    let result: IDBValidKey[] = [];
    req.onsuccess = () => {
      result = req.result;
    };
    tx.oncomplete = () => {
      db.close();
      resolve(new Set(result.map(String)));
    };
    tx.onerror = () => {
      db.close();
      reject(tx.error);
    };
  });
}

/**
 * The named entries only, in the order asked for, skipping ids that are gone.
 * One transaction, one `get` each — cheaper than pulling the whole store to
 * pick a pool's worth out of it.
 */
export async function getSequenceMediaByIds(
  ids: string[],
): Promise<StoredSequenceMedia[]> {
  if (ids.length === 0) return [];
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, "readonly");
    const store = tx.objectStore(STORE);
    const found = new Map<string, StoredSequenceMedia>();
    for (const id of ids) {
      const req = store.get(id);
      req.onsuccess = () => {
        const entry = req.result as StoredSequenceMedia | undefined;
        if (entry) found.set(id, entry);
      };
    }
    tx.oncomplete = () => {
      db.close();
      resolve(ids.map((id) => found.get(id)).filter((m) => m !== undefined));
    };
    tx.onerror = () => {
      db.close();
      reject(tx.error);
    };
  });
}

/**
 * One connection and one transaction for the whole batch. Writing a few
 * hundred files one call at a time meant a few hundred database opens, which
 * took longer than everything else about adding them put together.
 */
export async function putSequenceMedia(
  entries: { id: string; file: File }[],
): Promise<void> {
  if (entries.length === 0) return;
  const addedAt = Date.now();
  const db = await openDb();
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction(STORE, "readwrite");
    const store = tx.objectStore(STORE);
    for (const { id, file } of entries) {
      const entry: StoredSequenceMedia = {
        id,
        name: file.name,
        blob: file,
        type: file.type,
        addedAt,
        lastModified: file.lastModified,
      };
      store.put(entry);
    }
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

/** Only pruning deletes blobs — removing a source just unlinks it from a pool. */
async function deleteSequenceMedia(id: string): Promise<void> {
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

/** The media ids saved for a song, or null when it has no pool yet. */
export async function loadMediaPool(key: string): Promise<string[] | null> {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(POOL_STORE, "readonly");
    const req = tx.objectStore(POOL_STORE).get(key);
    let result: StoredMediaPool | undefined;
    req.onsuccess = () => {
      result = req.result as StoredMediaPool | undefined;
    };
    tx.oncomplete = () => {
      db.close();
      resolve(result ? result.sourceIds : null);
    };
    tx.onerror = () => {
      db.close();
      reject(tx.error);
    };
  });
}

export async function saveMediaPool(
  key: string,
  sourceIds: string[],
): Promise<void> {
  const entry: StoredMediaPool = { key, sourceIds, updatedAt: Date.now() };
  const db = await openDb();
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction(POOL_STORE, "readwrite");
    tx.objectStore(POOL_STORE).put(entry);
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

export async function getAllMediaPools(): Promise<StoredMediaPool[]> {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(POOL_STORE, "readonly");
    const req = tx.objectStore(POOL_STORE).getAll();
    let result: StoredMediaPool[] = [];
    req.onsuccess = () => {
      result = req.result as StoredMediaPool[];
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

async function deleteMediaPool(key: string): Promise<void> {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(POOL_STORE, "readwrite");
    tx.objectStore(POOL_STORE).delete(key);
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

/**
 * Drops least-recently-used pools, then media no retained pool references —
 * except the newest MAX_UNREFERENCED, which covers files added but not yet
 * assigned to a song.
 */
export async function pruneSequenceMedia(): Promise<void> {
  const pools = (await getAllMediaPools()).sort(
    (a, b) => b.updatedAt - a.updatedAt,
  );
  for (const stale of pools.slice(MAX_POOLS)) {
    await deleteMediaPool(stale.key);
  }

  const referenced = new Set<string>();
  for (const pool of pools.slice(0, MAX_POOLS)) {
    for (const id of pool.sourceIds) referenced.add(id);
  }

  // getAllSequenceMedia sorts oldest first, so the tail is what to keep.
  const unreferenced = (await getAllSequenceMedia()).filter(
    (m) => !referenced.has(m.id),
  );
  for (const entry of unreferenced.slice(0, -MAX_UNREFERENCED)) {
    await deleteSequenceMedia(entry.id);
  }
}

/**
 * Rebuilds a `File` from a stored entry so it can re-enter the pool.
 *
 * `lastModified` has to be carried across explicitly: the File constructor
 * defaults it to `Date.now()`, and since it feeds `stableSourceId`, a restored
 * file would come back under a brand-new id every time. Segments would never
 * resolve their source, and each restore would re-add the same media under yet
 * another id.
 */
export function storedMediaToFile(entry: StoredSequenceMedia): File {
  return new File([entry.blob], entry.name, {
    type: entry.type || entry.blob.type,
    lastModified: entry.lastModified ?? lastModifiedFromId(entry.id),
  });
}

/** Records written before `lastModified` existed still encode it in the id. */
function lastModifiedFromId(id: string): number {
  const n = Number(id.slice(id.lastIndexOf(":") + 1));
  return Number.isFinite(n) ? n : 0;
}
