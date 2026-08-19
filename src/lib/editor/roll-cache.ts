/**
 * Bounded cache for generated mosh rolls, shared by the sequence segments and
 * the fx-lane clips. Both key a roll by seed plus the mosh options it was
 * generated under, and both have to hand back the *same* instances every frame
 * a clip is on screen — re-rolling would restart every feedback effect.
 */

/** Newest kept, oldest dropped. The playhead moves forward, so insertion order
 * tracks recency closely enough that a real LRU would buy nothing. Dropping one
 * entry rather than clearing the map avoids the rebuild storm a full flush
 * caused the moment the cap was reached. */
export function putRoll<T>(cache: Map<string, T>, key: string, value: T, cap = 512): void {
  if (cache.size >= cap) {
    const oldest = cache.keys().next();
    if (!oldest.done) cache.delete(oldest.value);
  }
  cache.set(key, value);
}
