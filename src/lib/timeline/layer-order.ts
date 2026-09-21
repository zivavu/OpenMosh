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
	return refs.sort(
		(a, b) => b.z - a.z || KIND_RANK[a.kind] - KIND_RANK[b.kind],
	);
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

/** The lanes with the z each move gave them; untouched lanes come back as is. */
export function applyLayerMoves<L extends { id: string; z: number }>(
	lanes: L[],
	moves: { id: string; z: number }[],
): L[] {
	const byId = new Map(moves.map((m) => [m.id, m.z]));
	return lanes.map((l) => (byId.has(l.id) ? { ...l, z: byId.get(l.id)! } : l));
}

/** The layer row under a point, by the `data-layer-id` every row carries. */
export function layerRowIdAt(x: number, y: number): string | null {
	const el = document.elementFromPoint(x, y) as HTMLElement | null;
	return el?.closest<HTMLElement>("[data-layer-id]")?.dataset.layerId ?? null;
}

/**
 * A grip drag that restacks a layer row. Live reorder: the row under the
 * pointer trades places with the held one as it passes, so the stack always
 * shows where a drop would land. One undo entry for the gesture, however
 * many rows it crosses — `reorder` gets the same coalesce key every tick.
 */
export function startLayerRowDrag(
	e: PointerEvent,
	laneId: string,
	opts: {
		order: () => LayerRef[];
		reorder: (laneId: string, toIndex: number, coalesceKey: string) => void;
		setDragging: (laneId: string | null) => void;
	},
): void {
	if (e.button !== 0) return;
	e.preventDefault();
	e.stopPropagation();
	opts.setDragging(laneId);
	const handle = e.currentTarget as HTMLElement;
	handle.setPointerCapture(e.pointerId);
	const onMove = (ev: PointerEvent) => {
		const overId = layerRowIdAt(ev.clientX, ev.clientY);
		if (!overId || overId === laneId) return;
		const to = opts.order().findIndex((l) => l.id === overId);
		if (to !== -1) opts.reorder(laneId, to, `layer-drag-${laneId}`);
	};
	const onUp = (ev: PointerEvent) => {
		opts.setDragging(null);
		handle.releasePointerCapture?.(ev.pointerId);
		window.removeEventListener("pointermove", onMove);
		window.removeEventListener("pointerup", onUp);
		window.removeEventListener("pointercancel", onUp);
	};
	window.addEventListener("pointermove", onMove);
	window.addEventListener("pointerup", onUp);
	window.addEventListener("pointercancel", onUp);
}
