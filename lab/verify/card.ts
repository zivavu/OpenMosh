// The animated test footage both verify pages run shaders over, and the query
// flags that shape it.

export const W = 480;
export const H = 270;
export const FPS = 30;
const query = new URLSearchParams(location.search);
// `?motion` pans the scene like a handheld camera; `?cut` hard-cuts to the B card
// halfway; `?strip` keeps three frames per shader instead of the last one.
export const motion = query.has("motion");
export const cut = query.has("cut");
export const strip = query.has("strip");
// `?set=hold:1,gain:2` overrides params by name, for every shader in the run.
export const overrides = (query.get("set") ?? "")
	.split(",")
	.filter(Boolean)
	.map((kv) => kv.split(":") as [string, string]);
export const FRAMES = motion || cut ? 75 : 45;
export const STRIP_AT = [
	Math.round(FRAMES / 2) + 2,
	Math.round(FRAMES * 0.75),
	FRAMES - 1,
];

export function drawCard(
	ctx: CanvasRenderingContext2D,
	t: number,
	variant: 0 | 1,
) {
	const pan = motion ? t * 70 : 0;
	const sky = ctx.createLinearGradient(0, 0, 0, H);
	sky.addColorStop(0, variant ? "#1b2a6b" : "#2a7fd4");
	sky.addColorStop(1, variant ? "#e0607a" : "#f3d9a4");
	ctx.fillStyle = sky;
	ctx.fillRect(0, 0, W, H);
	ctx.fillStyle = "#ffd23f";
	ctx.beginPath();
	ctx.arc(360 - pan * 0.3, 70, 34, 0, Math.PI * 2);
	ctx.fill();
	ctx.fillStyle = variant ? "#241a3a" : "#2f6b3a";
	ctx.beginPath();
	ctx.moveTo(0, 200);
	for (let x = 0; x <= W; x += 20)
		ctx.lineTo(x, 190 + Math.sin((x + pan) * 0.03 + 1) * 18);
	ctx.lineTo(W, H);
	ctx.lineTo(0, H);
	ctx.fill();
	// A moving subject, so motion- and time-based shaders have something to chew on.
	const bx = 60 + ((t * 160) % (W - 120));
	ctx.fillStyle = "#e8402a";
	ctx.beginPath();
	ctx.arc(bx, 150 + Math.sin(t * 6) * 20, 26, 0, Math.PI * 2);
	ctx.fill();
	ctx.fillStyle = "#111";
	ctx.fillRect(150 - pan, 110, 34, 90);
	ctx.beginPath();
	ctx.arc(167 - pan, 98, 16, 0, Math.PI * 2);
	ctx.fill();
	ctx.fillStyle = "#fff";
	ctx.font = "bold 34px sans-serif";
	ctx.fillText(variant ? "B SIDE" : "OpenMosh", 230 - pan, 150);
	const bars = ["#fff", "#ff0", "#0ff", "#0f0", "#f0f", "#f00", "#00f", "#000"];
	bars.forEach((c, i) => {
		ctx.fillStyle = c;
		ctx.fillRect((i * W) / 8, 236, W / 8 + 1, 34);
	});
}
