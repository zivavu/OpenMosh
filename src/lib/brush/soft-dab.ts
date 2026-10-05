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
