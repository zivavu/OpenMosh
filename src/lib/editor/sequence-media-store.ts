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

import { request, transact } from "../idb";
import { requestPersistentStorage } from "../persistent-storage";
import { PROXY_BUILD } from "../video/proxy";

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

/**
 * A ≤1080p preview re-encode of some media (see video/proxy.ts), keyed by the
 * same content-derived id as its source. Its own store rather than a field on
 * the media entry: a single-mode file is deliberately not persisted, and a
 * proxy that died with that decision would re-transcode on every start.
 */
export interface StoredSequenceProxy {
	id: string;
	blob: Blob;
	addedAt: number;
	/** The transcoder build that made it — see PROXY_BUILD. Absent on entries
	 * written before proxies were stamped, which is itself reason to rebuild. */
	build?: number;
}

/** The set of media one song's timeline draws from. */
export interface StoredMediaPool {
	key: string;
	sourceIds: string[];
	updatedAt: number;
}

/**
 * One song's sequence/single timeline: segments, fx lanes, text, media layers.
 * Hundreds of kilobytes a song, which is what outgrew its old localStorage home.
 */
export interface StoredTimeline {
	/** The mode-prefixed track key: `seq:<id>` or `single:<id>`. */
	key: string;
	/** Shape is owned by the editor, like a session's `state`. */
	state: unknown;
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
const TIMELINE_STORE = "timelines";
const PROXY_STORE = "proxies";
const DB_VERSION = 5;
/** Least recently used pools past this are dropped. */
const MAX_POOLS = 20;
/** Same, for sessions — they compete with pools for the one media store. */
const MAX_SESSIONS = 20;
/** Timelines are the largest records here, and only the recent ones matter. */
const MAX_TIMELINES = 40;
/**
 * Media belonging to no retained pool is kept up to this many entries, newest
 * first. Freshly added files land here until the pool save catches up, so this
 * must not be so tight that an add races its own eviction.
 */
const MAX_UNREFERENCED = 64;

/**
 * Proxies belonging to no referenced media are kept up to this many entries,
 * newest first — a session-scoped source (a single-mode file) has no pool or
 * session pointing at it, and its proxy is the one thing worth keeping
 * between runs.
 */
const MAX_UNREFERENCED_PROXIES = 16;

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

const REQUIRED_STORES = [
	STORE,
	POOL_STORE,
	SESSION_STORE,
	TIMELINE_STORE,
	PROXY_STORE,
];

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
			if (!db.objectStoreNames.contains(TIMELINE_STORE)) {
				db.createObjectStore(TIMELINE_STORE, { keyPath: "key" });
			}
			if (!db.objectStoreNames.contains(PROXY_STORE)) {
				db.createObjectStore(PROXY_STORE, { keyPath: "id" });
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

/** Every record in a store. */
async function readAll<T>(store: string): Promise<T[]> {
	const db = await openDb();
	return transact(db, store, "readonly", (tx) =>
		request(tx.objectStore(store).getAll() as IDBRequest<T[]>),
	);
}

async function readOne<T>(store: string, key: string): Promise<T | undefined> {
	const db = await openDb();
	return transact(db, store, "readonly", (tx) =>
		request(tx.objectStore(store).get(key) as IDBRequest<T | undefined>),
	);
}

async function write(
	store: string,
	body: (store: IDBObjectStore) => void,
): Promise<void> {
	const db = await openDb();
	await transact(db, store, "readwrite", (tx) => body(tx.objectStore(store)));
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
	const all = await readAll<StoredSequenceMedia>(STORE);
	return all.sort((a, b) => a.addedAt - b.addedAt);
}

/**
 * Just the ids, without deserializing a blob per record. Callers that only need
 * to know what's stored (rather than read it) should use this: the media store
 * holds every image and video, so a full getAll there is the most expensive
 * read in the app.
 */
export async function getAllSequenceMediaIds(): Promise<Set<string>> {
	const db = await openDb();
	const keys = await transact(db, STORE, "readonly", (tx) =>
		request(tx.objectStore(STORE).getAllKeys()),
	);
	return new Set(keys.map(String));
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
	const found = await transact(db, STORE, "readonly", (tx) => {
		const store = tx.objectStore(STORE);
		return Promise.all(
			ids.map((id) =>
				request(store.get(id) as IDBRequest<StoredSequenceMedia | undefined>),
			),
		);
	});
	return found.filter((m) => m !== undefined);
}

/**
 * The stored preview proxy for this exact file, if one was persisted — keyed
 * by the same content-derived id as the media itself, so a proxy survives
 * reloads without its own identity anywhere.
 */
export async function getSequenceMediaProxy(file: File): Promise<File | null> {
	try {
		const db = await openDb();
		if (!hasAllStores(db)) return null;
		const entry = await readOne<StoredSequenceProxy>(
			PROXY_STORE,
			stableSourceId(file),
		);
		if (!entry?.blob) return null;
		// Made by an older transcoder: drop it and let the caller build a current
		// one, rather than previewing from a file this build would never produce.
		if (entry.build !== PROXY_BUILD) {
			void deleteSequenceProxy(entry.id).catch(() => {});
			return null;
		}
		return new File([entry.blob], file.name, { type: "video/mp4" });
	} catch {
		return null;
	}
}

/** Stores the preview proxy for this exact file, keyed by its source id. */
export function putSequenceMediaProxy(file: File, proxy: Blob): Promise<void> {
	const entry: StoredSequenceProxy = {
		id: stableSourceId(file),
		blob: proxy,
		addedAt: Date.now(),
		build: PROXY_BUILD,
	};
	return write(PROXY_STORE, (store) => {
		store.put(entry);
	});
}

/**
 * Drops the stored proxy for this file. The one caller is a proxy that came
 * back from storage and then wouldn't open: kept, it would fail the same way
 * on every retry, since a retry looks in storage first.
 */
export async function deleteSequenceMediaProxy(file: File): Promise<void> {
	await deleteSequenceProxy(stableSourceId(file));
}

export function getAllSequenceProxies(): Promise<StoredSequenceProxy[]> {
	return readAll<StoredSequenceProxy>(PROXY_STORE);
}

export function deleteSequenceProxy(id: string): Promise<void> {
	return write(PROXY_STORE, (store) => {
		store.delete(id);
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
	// First save of real work: ask to be exempt from quota eviction.
	void requestPersistentStorage();
	const addedAt = Date.now();
	await write(STORE, (store) => {
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
	});
}

/** Only pruning and the storage manager delete blobs — removing a source from
 * the editor just unlinks it from a pool. */
export function deleteSequenceMedia(id: string): Promise<void> {
	return write(STORE, (store) => {
		store.delete(id);
	});
}

/** The media ids saved for a song, or null when it has no pool yet. */
export async function loadMediaPool(key: string): Promise<string[] | null> {
	const pool = await readOne<StoredMediaPool>(POOL_STORE, key);
	return pool ? pool.sourceIds : null;
}

export function saveMediaPool(key: string, sourceIds: string[]): Promise<void> {
	// First save of real work: ask to be exempt from quota eviction.
	void requestPersistentStorage();
	const entry: StoredMediaPool = { key, sourceIds, updatedAt: Date.now() };
	return write(POOL_STORE, (store) => {
		store.put(entry);
	});
}

export function getAllMediaPools(): Promise<StoredMediaPool[]> {
	return readAll<StoredMediaPool>(POOL_STORE);
}

export function deleteMediaPool(key: string): Promise<void> {
	return write(POOL_STORE, (store) => {
		store.delete(key);
	});
}

export function getAllSessions(): Promise<StoredSession[]> {
	return readAll<StoredSession>(SESSION_STORE);
}

export async function getSession(key: string): Promise<StoredSession | null> {
	return (await readOne<StoredSession>(SESSION_STORE, key)) ?? null;
}

export function putSession(
	entry: Omit<StoredSession, "updatedAt">,
): Promise<void> {
	// First save of real work: ask to be exempt from quota eviction.
	void requestPersistentStorage();
	const record: StoredSession = { ...entry, updatedAt: Date.now() };
	return write(SESSION_STORE, (store) => {
		store.put(record);
	});
}

export function deleteSession(key: string): Promise<void> {
	return write(SESSION_STORE, (store) => {
		store.delete(key);
	});
}

/** One song's stored timeline, or null when it has none. */
export async function getTimeline(key: string): Promise<unknown | null> {
	const entry = await readOne<StoredTimeline>(TIMELINE_STORE, key);
	return entry ? entry.state : null;
}

export function putTimeline(key: string, state: unknown): Promise<void> {
	// First save of real work: ask to be exempt from quota eviction.
	void requestPersistentStorage();
	const entry: StoredTimeline = { key, state, updatedAt: Date.now() };
	return write(TIMELINE_STORE, (store) => {
		store.put(entry);
	});
}

export async function getAllTimelines(): Promise<StoredTimeline[]> {
	return (await readAll<StoredTimeline>(TIMELINE_STORE)) ?? [];
}

export function deleteTimeline(key: string): Promise<void> {
	return write(TIMELINE_STORE, (store) => {
		store.delete(key);
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
	const orphaned = allSessions.filter(
		(s) => s.mode === "slideshow" && !s.trackId,
	);
	for (const stale of orphaned) {
		await deleteSession(stale.key);
	}

	const sessions = allSessions
		.filter((s) => !orphaned.includes(s))
		.sort((a, b) => b.updatedAt - a.updatedAt);
	for (const stale of sessions.slice(MAX_SESSIONS)) {
		await deleteSession(stale.key);
	}

	const timelines = (await getAllTimelines()).sort(
		(a, b) => b.updatedAt - a.updatedAt,
	);
	for (const stale of timelines.slice(MAX_TIMELINES)) {
		await deleteTimeline(stale.key);
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

	// A proxy whose source is gone can never be looked up against again — its
	// id is derived from the source file — so past the newest few, they are
	// disk spent on nothing.
	const proxies = (await getAllSequenceProxies()).sort(
		(a, b) => b.addedAt - a.addedAt,
	);
	const staleProxies = proxies
		.filter((p) => !referenced.has(p.id))
		.slice(MAX_UNREFERENCED_PROXIES);
	for (const entry of staleProxies) {
		await deleteSequenceProxy(entry.id);
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

/**
 * Empties every store at once, for the storage manager's "delete everything".
 * Clears rather than deleting the database: this module holds its connection
 * open, and `deleteDatabase` would sit blocked behind it.
 */
export async function clearAllSequenceStores(): Promise<void> {
	const db = await openDb();
	await transact(db, REQUIRED_STORES, "readwrite", (tx) => {
		for (const name of REQUIRED_STORES) tx.objectStore(name).clear();
	});
}
