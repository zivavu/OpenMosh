/** The object entries of a saved list. A damaged save or a hand-edited project file
 * can hold nulls or stray values where records belong; those are dropped. */
export function records<T>(raw: unknown): Partial<T>[] {
	if (!Array.isArray(raw)) return [];
	return raw.filter(
		(item): item is Partial<T> => !!item && typeof item === "object",
	);
}

/** A saved number, or `fallback` when a damaged save or a hand-edited project file
 * holds anything else there. */
export function finiteOr<F>(value: unknown, fallback: F): number | F {
	return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}
