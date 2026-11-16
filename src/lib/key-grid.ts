/** The song's beat grid that keys land on, in timeline seconds. */

export interface KeyGrid {
	/** Seconds between lines. */
	step: number;
	/** A line's time: the song's first beat. */
	offset: number;
}

/** The spacings offered, in beats. */
export const KEY_GRID_DIVISIONS = [
	{ beats: 4, label: "Bar" },
	{ beats: 1, label: "Beat" },
	{ beats: 0.5, label: "1/2 beat" },
	{ beats: 0.25, label: "1/4 beat" },
	{ beats: 0.125, label: "1/8 beat" },
];

export function keyGridOf(
	bpm: number,
	beatOffset: number,
	beats: number,
): KeyGrid | null {
	if (!(bpm > 0) || !(beats > 0)) return null;
	return { step: (60 / bpm) * beats, offset: beatOffset };
}

/** The line nearest `t`. */
export function onGrid(t: number, grid: KeyGrid): number {
	return Math.round((t - grid.offset) / grid.step) * grid.step + grid.offset;
}

/** The first line past `t` in `direction`; from between lines, the one that way. */
export function nextGridLine(
	t: number,
	grid: KeyGrid,
	direction: -1 | 1,
): number {
	const n = (t - grid.offset) / grid.step;
	const near = Math.round(n);
	const on = Math.abs(n - near) < 1e-6;
	const k = on
		? near + direction
		: direction > 0
			? Math.ceil(n)
			: Math.floor(n);
	return k * grid.step + grid.offset;
}

/** The line nearest `t` between `from` and `to`, or `t` held to them when no line
 * falls between. */
export function onGridWithin(
	t: number,
	grid: KeyGrid,
	from: number,
	to: number,
): number {
	const at = onGrid(t, grid);
	if (at >= from - 1e-6 && at <= to + 1e-6) return at;
	const inside =
		at < from ? nextGridLine(from, grid, 1) : nextGridLine(to, grid, -1);
	if (inside >= from - 1e-6 && inside <= to + 1e-6) return inside;
	return Math.min(Math.max(t, from), to);
}
