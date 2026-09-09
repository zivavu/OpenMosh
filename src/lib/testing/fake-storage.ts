/**
 * A localStorage stand-in for the test runner, which has no DOM.
 *
 * Beyond holding values it can be told to fail the way a browser does: a full
 * quota, or a private window where touching the API throws outright. Those are
 * the paths storage.ts exists to absorb, so they need to be reachable here.
 */

export interface FakeLocalStorage {
	store: Map<string, string>;
	/** Throw on every read and write, like a locked-down private window. */
	unavailable: boolean;
	/** Throw on writes only, like a full quota. */
	full: boolean;
	/** Seed a key with a raw string, bypassing the failure flags. */
	seed(key: string, value: string): void;
	seedJson(key: string, value: unknown): void;
	restore(): void;
}

class QuotaExceededError extends Error {
	constructor() {
		super("QuotaExceededError");
		this.name = "QuotaExceededError";
	}
}

/**
 * Install the fake on globalThis and hand back its controls. Call `restore()`
 * in an afterEach so one test's keys can't leak into the next.
 */
export function installFakeLocalStorage(): FakeLocalStorage {
	const store = new Map<string, string>();
	const had = "localStorage" in globalThis;
	const previous = (globalThis as { localStorage?: Storage }).localStorage;

	const handle: FakeLocalStorage = {
		store,
		unavailable: false,
		full: false,
		seed(key, value) {
			store.set(key, value);
		},
		seedJson(key, value) {
			store.set(key, JSON.stringify(value));
		},
		restore() {
			if (had) {
				(globalThis as { localStorage?: Storage }).localStorage = previous;
			} else {
				delete (globalThis as { localStorage?: Storage }).localStorage;
			}
		},
	};

	const guard = () => {
		if (handle.unavailable) throw new Error("SecurityError");
	};

	const fake: Storage = {
		get length() {
			guard();
			return store.size;
		},
		key(index: number) {
			guard();
			return [...store.keys()][index] ?? null;
		},
		getItem(key: string) {
			guard();
			return store.get(key) ?? null;
		},
		setItem(key: string, value: string) {
			guard();
			if (handle.full) throw new QuotaExceededError();
			store.set(key, String(value));
		},
		removeItem(key: string) {
			guard();
			store.delete(key);
		},
		clear() {
			guard();
			store.clear();
		},
	};

	(globalThis as { localStorage?: Storage }).localStorage = fake;
	return handle;
}
