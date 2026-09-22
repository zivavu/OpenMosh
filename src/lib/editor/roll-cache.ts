/** Bounded cache for generated mosh rolls, shared by fx and media clips. Both key a
 * roll by seed plus its options and must return the same instances every frame. */

/** Newest kept, oldest dropped: insertion order tracks recency closely enough, and
 * dropping one entry avoids the rebuild storm a full flush caused at the cap. */
export function putRoll<T>(
	cache: Map<string, T>,
	key: string,
	value: T,
	cap = 512,
): void {
	if (cache.size >= cap) {
		const oldest = cache.keys().next();
		if (!oldest.done) cache.delete(oldest.value);
	}
	cache.set(key, value);
}
