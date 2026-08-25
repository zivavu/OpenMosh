/**
 * One stacking order across every kind of layer — text lanes and media lanes
 * alike. Each lane carries a `z`; this is where the two lists are merged into
 * the order the compositor and the UI both read.
 *
 * Kept apart from the lanes themselves because neither timeline can see the
 * other: only whoever owns both (the editor) can say what "one above" means.
 */

export type LayerKind = "media" | "text";

/** The part of a lane the order cares about. */
export interface OrderedLane {
  id: string;
  name: string;
  enabled: boolean;
  z: number;
}

export interface LayerRef {
  id: string;
  name: string;
  kind: LayerKind;
  enabled: boolean;
  z: number;
}

/**
 * Every layer, front first — index 0 is the one drawn on top. Ties go to text,
 * which is where captions sat before the two orders were merged.
 */
export function combinedLayerOrder(
  media: OrderedLane[],
  text: OrderedLane[],
): LayerRef[] {
  const refs: LayerRef[] = [
    ...media.map((l) => ({ ...l, kind: "media" as const })),
    ...text.map((l) => ({ ...l, kind: "text" as const })),
  ];
  return refs.sort(
    (a, b) => b.z - a.z || (a.kind === b.kind ? 0 : a.kind === "text" ? -1 : 1),
  );
}

/** Above everything currently stacked. */
export function nextLayerZ(order: LayerRef[]): number {
  let top = -1;
  for (const l of order) top = Math.max(top, l.z);
  return top + 1;
}

/**
 * Move one layer `delta` steps toward the front (negative) or the back. Returns
 * the z each affected layer takes, or null when it is already at that end.
 *
 * The two swap z values rather than renumbering the stack: nothing else moves,
 * so a lane the user isn't touching can't change what it sits over.
 */
export function swapLayerZ(
  order: LayerRef[],
  id: string,
  delta: number,
): { id: string; z: number }[] | null {
  const from = order.findIndex((l) => l.id === id);
  if (from === -1) return null;
  const to = from + delta;
  if (to < 0 || to >= order.length) return null;
  const a = order[from];
  const b = order[to];
  // Equal z would leave the swap invisible — the tie-break decides instead of
  // the move. Nudge past the neighbour rather than onto it.
  if (a.z === b.z) {
    return [{ id: a.id, z: delta < 0 ? a.z + 1 : a.z - 1 }];
  }
  return [
    { id: a.id, z: b.z },
    { id: b.id, z: a.z },
  ];
}
