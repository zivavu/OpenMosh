/**
 * One stacking order across every kind of layer — text lanes and media lanes
 * alike. Each lane carries a `z`; this is where the two lists are merged into
 * the order the compositor and the UI both read.
 *
 * Kept apart from the lanes themselves because neither timeline can see the
 * other: only whoever owns both (the editor) can say what "one above" means.
 */

export type LayerKind = "media" | "text" | "fx";

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

/** Ties resolve in this order, front first: text, then media, then fx lanes —
 * where the three sat before their orders were merged. */
const KIND_RANK: Record<LayerKind, number> = { text: 0, media: 1, fx: 2 };

/**
 * Every row of the stack, front first — index 0 is the one applied last. An fx
 * lane belongs here alongside the layers: above one it processes that layer
 * too, below it the layer composites over what the lane produced.
 */
export function combinedLayerOrder(
  media: OrderedLane[],
  text: OrderedLane[],
  fx: OrderedLane[] = [],
): LayerRef[] {
  const refs: LayerRef[] = [
    ...media.map((l) => ({ ...l, kind: "media" as const })),
    ...text.map((l) => ({ ...l, kind: "text" as const })),
    ...fx.map((l) => ({ ...l, kind: "fx" as const })),
  ];
  return refs.sort((a, b) => b.z - a.z || KIND_RANK[a.kind] - KIND_RANK[b.kind]);
}

/** Where this lane sits, front-first, or -1 when it is not stacked at all. */
export function stackIndex(order: LayerRef[], laneId: string): number {
  return order.findIndex((l) => l.id === laneId);
}

/**
 * What a row's reorder handle says about where it sits: its neighbours, named.
 *
 * In terms of rows rather than layers, because an fx lane is neither above nor
 * below "a layer" — it is one more rung of the same stack.
 */
export function stackTitle(order: LayerRef[], laneId: string): string {
  const at = stackIndex(order, laneId);
  if (at === -1) return "";
  const above = order[at - 1];
  const below = order[at + 1];
  if (!above && !below) return "The only row in the stack";
  if (!above) return `On top, over ${below.name}`;
  if (!below) return `At the foot, under ${above.name}`;
  return `Under ${above.name}, over ${below.name}`;
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
