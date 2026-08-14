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

/** Modes that resume from a session record rather than a song's media pool. */
export type SessionMode = "single" | "slideshow";

/**
 * A resumable edit outside sequence mode. Unlike a pool, this carries the
 * editor state as well as the media, because there's no song to key a separate
 * timeline entry against — the media *is* the identity.
 */
export interface StoredSession {
  key: string;
  mode: SessionMode;
  /** What the upload screen shows: the song's name, or the media's. */
  label: string;
  /** The song this edit belongs to, when one was loaded. Part of the key. */
  trackId?: string;
  sourceIds: string[];
  /** Mode-specific; shape is owned by whoever wrote it. */
  state: unknown;
  updatedAt: number;
}

const DB_NAME = "openmosh-sequence-media";
const STORE = "media";
const POOL_STORE = "pools";
const SESSION_STORE = "sessions";
const DB_VERSION = 3;
/** Least recently used pools past this are dropped. */
const MAX_POOLS = 20;
/** Same, for sessions — they compete with pools for the one media store. */
const MAX_SESSIONS = 20;
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

/**
 * One shared connection for the whole module.
 *
 * This used to open and close a connection per call, which deadlocks the moment
 * the version changes: a version upgrade can't run while any other connection
 * to the database is still open, and callers here routinely overlap (the upload
 * screen alone kicks off three listings at once). The upgrade fires `blocked`
 * instead of `success`, and with no handler for it the promise simply never
 * settles — every read hangs forever, silently.
 */
let dbPromise: Promise<IDBDatabase> | null = null;

const REQUIRED_STORES = [STORE, POOL_STORE, SESSION_STORE];

function hasAllStores(db: IDBDatabase): boolean {
  return REQUIRED_STORES.every((name) => db.objectStoreNames.contains(name));
}

/** Omit `version` to open at whatever the stored version happens to be. */
function openAt(version?: number): Promise<IDBDatabase> {
  return new Promise<IDBDatabase>((resolve, reject) => {
    const req =
      version === undefined
        ? indexedDB.open(DB_NAME)
        : indexedDB.open(DB_NAME, version);
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
      if (!db.objectStoreNames.contains(SESSION_STORE)) {
        db.createObjectStore(SESSION_STORE, { keyPath: "key" });
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
    // Another connection is holding the old version open. Fail loudly rather
    // than hanging: callers can retry once that connection goes away.
    req.onblocked = () =>
      reject(
        new Error("openmosh-sequence-media upgrade blocked by another tab"),
      );
  });
}

function openDb(): Promise<IDBDatabase> {
  if (dbPromise) return dbPromise;
  dbPromise = (async () => {
    // Opened without a version first: DB_VERSION is a floor, not an exact
    // demand. Asking for a specific version fails outright against a database
    // that's already past it, which is easy to end up with — a repair below
    // bumps it, and any future rollback of DB_VERSION would too.
    let db = await openAt();
    // A database at or past the current version but missing a store can't be
    // repaired by opening it again — `upgradeneeded` only fires on a version
    // bump. That state comes from an interrupted upgrade, or a hot reload that
    // left an older connection alive. Force the next version so the creation
    // path runs, rather than failing every write from here on.
    if (db.version < DB_VERSION || !hasAllStores(db)) {
      const next = Math.max(DB_VERSION, db.version + 1);
      db.close();
      db = await openAt(next);
    }
    // Another tab upgrading needs us out of the way, and the handle is dead
    // afterwards — drop it so the next call reopens.
    db.onversionchange = () => {
      db.close();
      dbPromise = null;
    };
    db.onclose = () => {
      dbPromise = null;
    };
    return db;
  })();
  // Don't cache a rejection: the blocking tab may be gone by the next call.
  // Compared by identity so a retry that already replaced this one survives.
  const pending = dbPromise;
  pending.catch(() => {
    if (dbPromise === pending) dbPromise = null;
  });
  return pending;
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
      result.sort((a, b) => a.addedAt - b.addedAt);
      resolve(result);
    };
    tx.onerror = () => {
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
      resolve(new Set(result.map(String)));
    };
    tx.onerror = () => {
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
      resolve(ids.map((id) => found.get(id)).filter((m) => m !== undefined));
    };
    tx.onerror = () => {
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
      resolve();
    };
    tx.onerror = () => {
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
      resolve();
    };
    tx.onerror = () => {
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
      resolve(result ? result.sourceIds : null);
    };
    tx.onerror = () => {
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
      resolve();
    };
    tx.onerror = () => {
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
      resolve(result);
    };
    tx.onerror = () => {
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
      resolve();
    };
    tx.onerror = () => {
      reject(tx.error);
    };
  });
}

export async function getAllSessions(): Promise<StoredSession[]> {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(SESSION_STORE, "readonly");
    const req = tx.objectStore(SESSION_STORE).getAll();
    let result: StoredSession[] = [];
    req.onsuccess = () => {
      result = req.result as StoredSession[];
    };
    tx.oncomplete = () => {
      resolve(result);
    };
    tx.onerror = () => {
      reject(tx.error);
    };
  });
}

export async function getSession(key: string): Promise<StoredSession | null> {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(SESSION_STORE, "readonly");
    const req = tx.objectStore(SESSION_STORE).get(key);
    let result: StoredSession | undefined;
    req.onsuccess = () => {
      result = req.result as StoredSession | undefined;
    };
    tx.oncomplete = () => {
      resolve(result ?? null);
    };
    tx.onerror = () => {
      reject(tx.error);
    };
  });
}

export async function putSession(
  entry: Omit<StoredSession, "updatedAt">,
): Promise<void> {
  const record: StoredSession = { ...entry, updatedAt: Date.now() };
  const db = await openDb();
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction(SESSION_STORE, "readwrite");
    tx.objectStore(SESSION_STORE).put(record);
    tx.oncomplete = () => {
      resolve();
    };
    tx.onerror = () => {
      reject(tx.error);
    };
  });
}

export async function deleteSession(key: string): Promise<void> {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(SESSION_STORE, "readwrite");
    tx.objectStore(SESSION_STORE).delete(key);
    tx.oncomplete = () => {
      resolve();
    };
    tx.onerror = () => {
      reject(tx.error);
    };
  });
}

/**
 * Drops least-recently-used pools and sessions, then media neither a retained
 * pool nor a retained session references — except the newest MAX_UNREFERENCED,
 * which covers files added but not yet assigned to a song.
 */
export async function pruneSequenceMedia(): Promise<void> {
  const pools = (await getAllMediaPools()).sort(
    (a, b) => b.updatedAt - a.updatedAt,
  );
  for (const stale of pools.slice(MAX_POOLS)) {
    await deleteMediaPool(stale.key);
  }

  const allSessions = await getAllSessions();
  // Slideshow sessions keyed by media rather than a song date from before the
  // upload screen required a track. They can't be recreated, and one editing
  // pass left a separate entry behind for every image added or removed, so the
  // list fills up with near-duplicates of the same slideshow.
  const orphaned = allSessions.filter((s) => s.mode === "slideshow" && !s.trackId);
  for (const stale of orphaned) {
    await deleteSession(stale.key);
  }

  const sessions = allSessions
    .filter((s) => !orphaned.includes(s))
    .sort((a, b) => b.updatedAt - a.updatedAt);
  for (const stale of sessions.slice(MAX_SESSIONS)) {
    await deleteSession(stale.key);
  }

  const referenced = new Set<string>();
  for (const pool of pools.slice(0, MAX_POOLS)) {
    for (const id of pool.sourceIds) referenced.add(id);
  }
  // Sessions hold the only reference to single/slideshow media — miss these and
  // resuming would come back to an empty editor.
  for (const session of sessions.slice(0, MAX_SESSIONS)) {
    for (const id of session.sourceIds) referenced.add(id);
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
