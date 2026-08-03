/**
 * Index math for the effect-chain reorder buttons. Kept separate from the panel
 * because the splice semantics are easy to get subtly wrong (and invisible when
 * they are — a move that lands one slot off still *looks* like it worked).
 */

/**
 * Where an item at visible position `pos` should land.
 *
 * `visibleIndices` maps the rendered rows to their indices in the full array;
 * with a search filter active those are not contiguous. Neighbours are taken
 * from the visible list so the result always matches what the user sees.
 *
 * Returns the destination index in the full array, or null when the move isn't
 * possible (already at that end).
 */
export function resolveMoveTarget(
  visibleIndices: number[],
  pos: number,
  direction: -1 | 1,
  toEnd: boolean,
): number | null {
  if (pos < 0 || pos >= visibleIndices.length) return null;
  const from = visibleIndices[pos];
  const targetPos = toEnd
    ? direction === -1
      ? 0
      : visibleIndices.length - 1
    : pos + direction;
  if (targetPos < 0 || targetPos >= visibleIndices.length) return null;
  const to = visibleIndices[targetPos];
  return to === from ? null : to;
}

/**
 * Move `from` to `to` in place.
 *
 * `to` is interpreted against the *pre-removal* array: moving down past index
 * `to` puts the item after whatever currently sits there, which is what the
 * visible neighbour of a downward move means.
 */
export function moveItem<T>(items: T[], from: number, to: number): void {
  if (from === to) return;
  const [moved] = items.splice(from, 1);
  items.splice(to, 0, moved);
}
