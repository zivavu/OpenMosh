/**
 * Index math for the effect-chain reorder buttons. Kept separate from the panel
 * because the splice semantics are easy to get subtly wrong (and invisible when
 * they are — a move that lands one slot off still *looks* like it worked).
 */

export interface MovableRow {
  /** Position in the full effects array. */
  index: number;
  enabled: boolean;
}

/**
 * Where an item at visible position `pos` should land.
 *
 * `visible` maps the rendered rows to the full array; with a search filter
 * active those indices are not contiguous. Neighbours are taken from the
 * visible list so the result always matches what the user sees.
 *
 * A single step moves past the next *enabled* row rather than the next row:
 * disabled effects are inert in the chain, so stepping over one would reorder
 * nothing that renders and the button would look broken. When there is no
 * enabled row left in that direction, the item goes to that end of the list.
 *
 * Returns the destination index in the full array, or null when the move isn't
 * possible (already at that end).
 */
export function resolveMoveTarget(
  visible: MovableRow[],
  pos: number,
  direction: -1 | 1,
  toEnd: boolean,
): number | null {
  if (pos < 0 || pos >= visible.length) return null;
  const from = visible[pos].index;
  const lastPos = visible.length - 1;

  let targetPos = direction === -1 ? 0 : lastPos;
  if (!toEnd) {
    for (let p = pos + direction; p >= 0 && p <= lastPos; p += direction) {
      if (visible[p].enabled) {
        targetPos = p;
        break;
      }
    }
  }

  const to = visible[targetPos].index;
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
