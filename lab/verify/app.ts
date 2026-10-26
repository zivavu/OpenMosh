// Runs one of the app's own effects through the real GlRenderer over the same
// animated footage as the shader verify, so a port can be judged against its lab
// original. `bun lab/verify/run.ts --app=<effectId>`; the clock runs at 120 BPM.

import type { VerifyResult } from "./verify";
import { FPS, FRAMES, H, STRIP_AT, W, cut, drawCard, overrides } from "./card";

const query = new URLSearchParams(location.search);
const effectId = query.get("effect") ?? "";
// `?before=shake,zoom` runs those effects, at their defaults, ahead of the one tested.
const before = (query.get("before") ?? "").split(",").filter(Boolean);
// `?still` freezes the footage on its first frame.
const still = query.has("still");

// Loaded by URL so the lab's tsconfig doesn't typecheck the app through these.
const load = (path: string) => import(/* @vite-ignore */ path);

async function run() {
	const { GlRenderer } = await load("/src/lib/gl/renderer.ts");
	const { hydrateValues } = await load("/src/lib/effects/hydrate.ts");
	const errors: string[] = [];
	const realError = console.error;
	console.error = (...args: unknown[]) => {
		errors.push(args.map(String).join(" "));
		realError(...args);
	};

	const values = hydrateValues(effectId, {}) as Record<string, number | string>;
	for (const [k, v] of overrides)
		if (k in values) values[k] = typeof values[k] === "number" ? Number(v) : v;
	const chain = [
		...before.map((defId) => ({
			instanceId: `before-${defId}`,
			defId,
			enabled: true,
			locked: false,
			expanded: false,
			values: hydrateValues(defId, {}),
		})),
		{
			instanceId: "verify",
			defId: effectId,
			enabled: true,
			locked: false,
			expanded: false,
			values,
		},
	];

	const card = document.createElement("canvas");
	card.width = W;
	card.height = H;
	const ctx = card.getContext("2d")!;
	const canvas = document.createElement("canvas");
	canvas.width = W;
	canvas.height = H;
	const renderer = new GlRenderer(canvas);
	renderer.resize(W, H);
	renderer.initVideoSource(W, H);

	const shown = [0, ...STRIP_AT];
	const sheet = document.createElement("canvas");
	sheet.width = W * 2;
	sheet.height = Math.ceil(shown.length / 2) * (H + 16);
	const sctx = sheet.getContext("2d")!;
	sctx.fillStyle = "#000";
	sctx.fillRect(0, 0, sheet.width, sheet.height);
	sctx.font = "11px sans-serif";
	let cell = 0;
	const thumb = (from: CanvasImageSource, label: string) => {
		const x = (cell % 2) * W;
		const y = Math.floor(cell / 2) * (H + 16);
		sctx.drawImage(from, x, y, W, H);
		sctx.fillStyle = "#d7dae0";
		sctx.fillText(label, x + 4, y + H + 12);
		cell++;
	};

	// Mean difference from the source per frame: a keyframe shows as a drop to ~0.
	const gl = canvas.getContext("webgl2") as WebGL2RenderingContext;
	const out = new Uint8Array(W * H * 4);
	const trace: number[] = [];
	const diffFromSource = () => {
		gl.bindFramebuffer(gl.FRAMEBUFFER, null);
		gl.readPixels(0, 0, W, H, gl.RGBA, gl.UNSIGNED_BYTE, out);
		const src = ctx.getImageData(0, 0, W, H).data;
		let d = 0;
		for (let y = 0; y < H; y += 3)
			for (let x = 0; x < W; x += 3) {
				const o = ((H - 1 - y) * W + x) * 4;
				const i = (y * W + x) * 4;
				d += Math.abs(out[o] - src[i]) + Math.abs(out[o + 1] - src[i + 1]);
			}
		return d / ((W / 3) * (H / 3) * 2);
	};

	let ms = 0;
	for (let f = 0; f < FRAMES; f++) {
		const t = f / FPS;
		drawCard(ctx, still ? 0 : t, cut && f >= FRAMES / 2 ? 1 : 0);
		const frame = new VideoFrame(card, { timestamp: Math.round(t * 1e6) });
		renderer.updateSourceFrame(frame);
		frame.close();
		renderer.setBeat(t * 2, 2);
		const t0 = performance.now();
		renderer.render(chain, t);
		ms += performance.now() - t0;
		trace.push(diffFromSource());
		if (f === FRAMES - 1) thumb(card, "(source)");
		if (STRIP_AT.includes(f)) thumb(canvas, `${effectId} @${f}`);
	}
	const result: VerifyResult = {
		name: `app/${effectId}`,
		ok: errors.length === 0,
		error: errors.join("\n") || undefined,
		warnings: [
			`Δ per frame: ${trace.map((d, f) => `${f}:${d.toFixed(0)}`).join(" ")}`,
		],
		diff: 0,
		stddev: 0,
		ms: ms / FRAMES,
	};
	(window as unknown as { __verify: unknown }).__verify = {
		results: [result],
		sheets: [sheet.toDataURL("image/png")],
	};
}

run();
