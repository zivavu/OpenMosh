/** localStorage access that can't throw. Every read survives a half-written value,
 * and every write a private window and a full quota. */

/** The stored value at `key`, or `fallback` when it's missing or unparseable. */
export function readJson<T>(key: string, fallback: T): T {
	try {
		const raw = localStorage.getItem(key);
		if (raw === null) return fallback;
		return JSON.parse(raw) as T;
	} catch {
		return fallback;
	}
}

/** Store `value` as JSON. Returns false when it couldn't be written. */
export function writeJson(key: string, value: unknown): boolean {
	try {
		localStorage.setItem(key, JSON.stringify(value));
		return true;
	} catch {
		return false;
	}
}

export function readRaw(key: string): string | null {
	try {
		return localStorage.getItem(key);
	} catch {
		return null;
	}
}

export function writeRaw(key: string, value: string): boolean {
	try {
		localStorage.setItem(key, value);
		return true;
	} catch {
		return false;
	}
}

/** A localStorage mirror of a list that really lives in IndexedDB, so a section
 * doesn't paint empty while the async load runs. Never the source of truth. */
export function createListCache<T>(
	key: string,
	isValid: (value: unknown) => value is T,
) {
	return {
		read(): T[] {
			const parsed = readJson<unknown>(key, null);
			return Array.isArray(parsed) ? parsed.filter(isValid) : [];
		},
		write(list: T[]): void {
			writeJson(key, list);
		},
	};
}
