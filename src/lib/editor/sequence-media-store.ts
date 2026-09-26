/** IndexedDB storage for sequence media; `pools` maps ids to songs. */

import { request, transact } from "../idb";
import { requestPersistentStorage } from "../persistent-storage";
import { PROXY_BUILD } from "../video/proxy";

export interface StoredSequenceMedia {
	id: string;
	name: string;
	blob: Blob;
	type: string;
	addedAt: number;
	/** Source mtime; part of the id, so a rebuilt File without it gets a new id. */
	lastModified?: number;
}

/** A <=1080p preview re-encode (see video/proxy.ts), keyed by its source's id. */
export interface StoredSequenceProxy {
	id: string;
	blob: Blob;
	addedAt: number;
	/** Transcoder build that made it (see PROXY_BUILD); absent means rebuild. */
	build?: number;
}

export interface StoredMediaPool {
	key: string;
	sourceIds: string[];
	updatedAt: number;
}

/** One song's timeline; hundreds of KB a song, which outgrew localStorage. */
export interface StoredTimeline {
	/** The mode-prefixed track key: `seq:<id>` or `single:<id>`. */
	key: string;
	/** Shape is owned by the editor, like a session's `state`. */
	state: unknown;
	updatedAt: number;
}

/** Modes that resume from a session record rather than a song's media pool. */
export type SessionMode = "single" | "slideshow";

/** A resumable edit outside sequence mode; the media *is* the identity. */
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
/** Same, for sessions; they compete with pools for the one media store. */
const MAX_SESSIONS = 20;
/** Timelines are the largest records here, and only the recent ones matter. */
const MAX_TIMELINES = 40;
/** Fresh files land here until the pool save catches up, kept up to this many. */
const MAX_UNREFERENCED = 64;

/** Unreferenced proxies kept up to this many; a session-scoped source has no pool. */
const MAX_UNREFERENCED_PROXIES = 16;

/** The name is percent-encoded so two names can't collapse onto one id. */
export function stableSourceId(file: File): string {
	return `src:${encodeURIComponent(file.name)}:${file.size}:${file.lastModified}`;
}

/** One shared connection; a connection per call deadlocks when the version changes. */
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

/** Omit `version` to open at the stored version. */
function openAt(version?: number): Promise<IDBDatabase> {
	return new Promise<IDBDatabase>((resolve, reject) => {
		const req =
			version === undefined
				? indexedDB.open(DB_NAME)
				: indexedDB.open(DB_NAME, version);
		// Guarded: v1 databases already have `media`, so upgrading must only add the
		// missing store.
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
		// Another connection holds the old version open; fail loudly rather than
		// hang, since callers can retry.
		req.onblocked = () =>
			reject(
				new Error("openmosh-sequence-media upgrade blocked by another tab"),
			);
	});
}

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
	await transact(db, store, "readwrite", (tx) => {
		body(tx.objectStore(store));
		// Committed now, not on auto-commit: a write started as the page unloads still lands.
		tx.commit();
	});
}

function openDb(): Promise<IDBDatabase> {
	if (dbPromise) return dbPromise;
	dbPromise = (async () => {
		// Opened without a version first: DB_VERSION is a floor, and asking for a
		// specific version fails against a database already past it.
		let db = await openAt();
		// A database at/past the version but missing a store can't be repaired by
		// reopening, since `upgradeneeded` only fires on a bump; force the next version.
		if (db.version < DB_VERSION || !hasAllStores(db)) {
			const next = Math.max(DB_VERSION, db.version + 1);
			db.close();
			db = await openAt(next);
		}
		// Another tab upgrading needs us out of the way; the handle is dead
		// afterwards, so drop it and let the next call reopen.
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

/** Just the ids; a full getAll deserializes a blob per record. */
export async function getAllSequenceMediaIds(): Promise<Set<string>> {
	const db = await openDb();
	const keys = await transact(db, STORE, "readonly", (tx) =>
		request(tx.objectStore(STORE).getAllKeys()),
	);
	return new Set(keys.map(String));
}

/** The named entries only, in the order asked for, skipping ids that are gone. */
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

/** The stored preview proxy for this file, keyed by the same id as the media. */
export async function getSequenceMediaProxy(file: File): Promise<File | null> {
	try {
		const db = await openDb();
		if (!hasAllStores(db)) return null;
		const entry = await readOne<StoredSequenceProxy>(
			PROXY_STORE,
			stableSourceId(file),
		);
		if (!entry?.blob) return null;
		// Made by an older transcoder: drop it and let the caller build a current one.
		if (entry.build !== PROXY_BUILD) {
			void deleteSequenceProxy(entry.id).catch(() => {});
			return null;
		}
		return new File([entry.blob], file.name, { type: "video/mp4" });
	} catch {
		return null;
	}
}

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

/** Drops the stored proxy for this file; one that won't open fails on every retry. */
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

/** One transaction for the batch; a call per file meant a few hundred database opens. */
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

/** Only pruning and the storage manager delete blobs; removing a source just unlinks it. */
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

/** Drops LRU pools and sessions, then media no retained pool or session
 * references, except the newest MAX_UNREFERENCED. */
export async function pruneSequenceMedia(): Promise<void> {
	const pools = (await getAllMediaPools()).sort(
		(a, b) => b.updatedAt - a.updatedAt,
	);
	for (const stale of pools.slice(MAX_POOLS)) {
		await deleteMediaPool(stale.key);
	}

	const allSessions = await getAllSessions();
	// Slideshow sessions keyed by media predate the track requirement; they can't be recreated.
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
	// Sessions hold the only reference to single/slideshow media; miss these and
	// resuming comes back empty.
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

	// A proxy whose source is gone can never be looked up again, since its id
	// derives from the source file.
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

/** Rebuilds a `File`; the constructor defaults `lastModified` to `Date.now()`. */
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

/** Empties every store; clears rather than deleting the DB, which the open connection blocks. */
export async function clearAllSequenceStores(): Promise<void> {
	const db = await openDb();
	await transact(db, REQUIRED_STORES, "readwrite", (tx) => {
		for (const name of REQUIRED_STORES) tx.objectStore(name).clear();
	});
}
