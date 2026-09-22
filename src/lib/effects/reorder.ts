/** Index math for the effect-chain reorder buttons, kept separate from the panel. */

export interface MovableRow {
	/** Position in the full effects array. */
	index: number;
	enabled: boolean;
}

/** Where an item at visible position `pos` should land. `visible` maps rendered rows to
 * the full array; a step moves past the next enabled row, or to the end. */
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

/** Move `from` to `to` in place; `to` is interpreted against the pre-removal array. */
export function moveItem<T>(items: T[], from: number, to: number): void {
	if (from === to) return;
	const [moved] = items.splice(from, 1);
	items.splice(to, 0, moved);
}
