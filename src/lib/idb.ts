/**
 * The IndexedDB plumbing every store module was spelling out by hand: a
 * request as a promise, a transaction that resolves once it commits, and the
 * "one database, one store keyed by id" shape the small libraries all take.
 */

/** A request's result, once it has one. */
export function request<T>(req: IDBRequest<T>): Promise<T> {
	return new Promise((resolve, reject) => {
		req.onsuccess = () => resolve(req.result);
		req.onerror = () => reject(req.error);
	});
}

/**
 * Run `body` inside one transaction and resolve with what it returned once
 * the transaction has committed. The body may return a promise built from
 * `request` calls — those settle before `complete` fires, so awaiting the
 * result never outlives the transaction.
 */
export function transact<T>(
	db: IDBDatabase,
	stores: string | string[],
	mode: IDBTransactionMode,
	body: (tx: IDBTransaction) => T | Promise<T>,
): Promise<T> {
	return new Promise((resolve, reject) => {
		const tx = db.transaction(stores, mode);
		let result: T | Promise<T>;
		try {
			result = body(tx);
		} catch (err) {
			tx.abort();
			reject(err);
			return;
		}
		// A failed request aborts the transaction too; catching it here keeps
		// the request's own error and stops it surfacing as unhandled.
		Promise.resolve(result).catch(reject);
		tx.oncomplete = () => resolve(result);
		tx.onerror = () => reject(tx.error);
		tx.onabort = () => reject(tx.error);
	});
}

/**
 * A database holding a single object store keyed by `id`. Every call opens a
 * fresh connection and closes it after — these libraries are read at most a
 * few times a session, and a held connection would block another tab's
 * upgrade for nothing.
 */
export function simpleStore(dbName: string, storeName: string, version = 1) {
	function open(): Promise<IDBDatabase> {
		const req = indexedDB.open(dbName, version);
		req.onupgradeneeded = () => {
			req.result.createObjectStore(storeName, { keyPath: "id" });
		};
		return request(req);
	}

	async function run<T>(
		mode: IDBTransactionMode,
		body: (store: IDBObjectStore) => T | Promise<T>,
	): Promise<T> {
		const db = await open();
		try {
			return await transact(db, storeName, mode, (tx) =>
				body(tx.objectStore(storeName)),
			);
		} finally {
			db.close();
		}
	}

	return {
		getAll: <T>() =>
			run("readonly", (s) => request(s.getAll() as IDBRequest<T[]>)),
		get: <T>(id: string) =>
			run("readonly", (s) => request(s.get(id) as IDBRequest<T | undefined>)),
		put: (value: unknown) =>
			run("readwrite", (s) => {
				s.put(value);
			}),
		delete: (id: string) =>
			run("readwrite", (s) => {
				s.delete(id);
			}),
		clear: () =>
			run("readwrite", (s) => {
				s.clear();
			}),
		run,
	};
}
