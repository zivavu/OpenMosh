/** The object entries of a saved list. A damaged save or a hand-edited project file
 * can hold nulls or stray values where records belong; those are dropped. */
export function records<T>(raw: unknown): Partial<T>[] {
	if (!Array.isArray(raw)) return [];
	return raw.filter(
		(item): item is Partial<T> => !!item && typeof item === "object",
	);
}
