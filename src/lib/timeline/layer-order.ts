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
 * Lift one layer out of the stack and drop it at `toIndex` (front-first, the
 * same indexing `order` uses). Returns the z every layer takes afterwards, or
 * null when nothing would move.
 *
 * The whole stack is renumbered rather than two entries swapped: a drag can
 * cross several rows at once, and consecutive integers keep the next drag from
 * having to reason about gaps or ties.
 */
export function moveLayerTo(
  order: LayerRef[],
  id: string,
  toIndex: number,
): { id: string; z: number }[] | null {
  const from = order.findIndex((l) => l.id === id);
  if (from === -1) return null;
  const to = Math.min(Math.max(toIndex, 0), order.length - 1);
  if (to === from) return null;
  const next = order.slice();
  const [moved] = next.splice(from, 1);
  next.splice(to, 0, moved);
  // Front of the list gets the highest z, so index 0 draws on top.
  return next.map((l, i) => ({ id: l.id, z: next.length - 1 - i }));
}
