/** Share of the radius a dab stays solid for; the rest fades to nothing. */
export const DEFAULT_DAB_CORE = 0.6;

/** One round dab of white (`on`) or black, solid to `core` of its radius and
 * fading linearly past it. Shared by the eraser and the Mask brush. */
export function softDab(
	ctx: CanvasRenderingContext2D,
	x: number,
	y: number,
	radius: number,
	on: boolean,
	core = DEFAULT_DAB_CORE,
) {
	const r = Math.max(radius, 1);
	const rgb = on ? "255,255,255" : "0,0,0";
	const grad = ctx.createRadialGradient(x, y, 0, x, y, r);
	grad.addColorStop(0, `rgba(${rgb},1)`);
	grad.addColorStop(Math.min(Math.max(core, 0), 1), `rgba(${rgb},1)`);
	grad.addColorStop(1, `rgba(${rgb},0)`);
	ctx.fillStyle = grad;
	ctx.beginPath();
	ctx.arc(x, y, r, 0, Math.PI * 2);
	ctx.fill();
}

/** A Mask brush dab on an opaque canvas. It keeps the brighter of itself and what's
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
