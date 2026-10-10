/** 0 = hard edge, 1 = fading from the centre. */
export const DEFAULT_BRUSH_SOFTNESS = 0.4;

/** One brush dab on an opaque mask canvas. It keeps the brighter of itself and what's
 * there (the darker when erasing), so overlaps don't build up and a stroke's edge is
 * as soft as one dab at any speed. Softness widens the fade and eases it out. */
export function maskDab(
	ctx: CanvasRenderingContext2D,
	x: number,
	y: number,
	radius: number,
	on: boolean,
	softness: number,
) {
	const r = Math.max(radius, 1);
	const s = Math.min(Math.max(softness, 0), 1);
	const core = 1 - s;
	// A Gaussian cut to reach 0 at the rim; steeper the softer the brush.
	const k = 2 + 6 * s * s;
	const rim = Math.exp(-k);
	const grad = ctx.createRadialGradient(x, y, 0, x, y, r);
	const grey = (f: number) => {
		const v = Math.round(255 * (on ? f : 1 - f));
		return `rgb(${v},${v},${v})`;
	};
	grad.addColorStop(0, grey(1));
	const STOPS = 16;
	for (let i = 0; i <= STOPS; i++) {
		const t = i / STOPS;
		const f = (Math.exp(-k * t * t) - rim) / (1 - rim);
		grad.addColorStop(core + s * t, grey(f));
	}
	ctx.save();
	ctx.globalCompositeOperation = on ? "lighten" : "darken";
	ctx.fillStyle = grad;
	ctx.beginPath();
	ctx.arc(x, y, r, 0, Math.PI * 2);
	ctx.fill();
	ctx.restore();
}

/** Lays a stroke's dabs evenly along the pointer's path, so it looks the same at
 * any speed. Make one per stroke. */
export function createStroke(
	dab: (x: number, y: number, radius: number) => void,
) {
	let last: { x: number; y: number } | null = null;
	let sinceDab = 0;
	return (x: number, y: number, radius: number) => {
		const gap = Math.max(1, radius / 8);
		if (!last) {
			dab(x, y, radius);
		} else {
			const len = Math.hypot(x - last.x, y - last.y);
			let d = gap - sinceDab;
			for (; d <= len; d += gap) {
				const t = d / len;
				dab(last.x + (x - last.x) * t, last.y + (y - last.y) * t, radius);
			}
			sinceDab = len - (d - gap);
		}
		last = { x, y };
	};
}
