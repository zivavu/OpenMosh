// Headless pass over every lab shader: compile, run a second of animated test
// footage through it, and flag output that is blank, black, or no different
// from the source. Driven by `bun lab/verify/run.ts`; also opens at /lab/verify/.

import {
	IsfEffect,
	parseIsf,
	defaultValue,
	type ImageBinding,
	type ParamValue,
} from "../isf";
import {
	H,
	W,
	FPS,
	FRAMES,
	STRIP_AT,
	cut,
	strip,
	overrides,
	drawCard,
} from "./card";

const fsFiles = import.meta.glob("../shaders/**/*.fs", {
	query: "?raw",
	eager: true,
	import: "default",
}) as Record<string, string>;
const vsFiles = import.meta.glob("../shaders/**/*.vs", {
	query: "?raw",
	eager: true,
	import: "default",
}) as Record<string, string>;

export interface VerifyResult {
	name: string;
	ok: boolean;
	error?: string;
	warnings: string[];
	/** Mean absolute difference from the source, 0–255. */
	diff: number;
	stddev: number;
	ms: number;
}

const canvas = document.createElement("canvas");
canvas.width = W;
canvas.height = H;
const gl = canvas.getContext("webgl2", {
	preserveDrawingBuffer: true,
	antialias: false,
	premultipliedAlpha: false,
})!;

function makeSlot(variant: 0 | 1) {
	const c = document.createElement("canvas");
	c.width = W;
	c.height = H;
	const ctx = c.getContext("2d")!;
	const texture = gl.createTexture()!;
	gl.bindTexture(gl.TEXTURE_2D, texture);
	gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
	gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
	gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
	gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
	const binding: ImageBinding = { texture, width: W, height: H };
	return {
		binding,
		draw(t: number, as: 0 | 1 = variant) {
			drawCard(ctx, t, as);
			gl.bindTexture(gl.TEXTURE_2D, texture);
			gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, true);
			gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, c);
			gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false);
		},
	};
}

const slotA = makeSlot(0);
const slotB = makeSlot(1);
const passthrough = new IsfEffect(
	gl,
	parseIsf(`/*{"INPUTS":[{"NAME":"inputImage","TYPE":"image"}]}*/
void main(){ gl_FragColor = IMG_THIS_NORM_PIXEL(inputImage); }`),
);

function read(): Uint8Array {
	const px = new Uint8Array(W * H * 4);
	gl.readPixels(0, 0, W, H, gl.RGBA, gl.UNSIGNED_BYTE, px);
	return px;
}

function stats(out: Uint8Array, src: Uint8Array) {
	let diff = 0;
	let sum = 0;
	let sum2 = 0;
	let black = 0;
	let srcBlack = 0;
	let n = 0;
	for (let i = 0; i < out.length; i += 4) {
		const l = (out[i] + out[i + 1] + out[i + 2]) / 3;
		diff +=
			(Math.abs(out[i] - src[i]) +
				Math.abs(out[i + 1] - src[i + 1]) +
				Math.abs(out[i + 2] - src[i + 2])) /
			3;
		sum += l;
		sum2 += l * l;
		if (l < 2) black++;
		if ((src[i] + src[i + 1] + src[i + 2]) / 3 < 2) srcBlack++;
		n++;
	}
	const mean = sum / n;
	return {
		diff: diff / n,
		mean,
		stddev: Math.sqrt(Math.max(0, sum2 / n - mean * mean)),
		blackGain: (black - srcBlack) / n,
	};
}

// `?big` lays sheets out at full render size, for a closer look at a few shaders.
const big = new URLSearchParams(location.search).has("big");
const THUMB_W = big ? W : 240;
const THUMB_H = big ? H : 135;
const COLS = big ? 2 : 5;
const PER_SHEET = big ? 6 : 30;

function newSheet(count: number) {
	const c = document.createElement("canvas");
	c.width = COLS * THUMB_W;
	c.height = Math.ceil(count / COLS) * (THUMB_H + 16);
	const ctx = c.getContext("2d")!;
	ctx.fillStyle = "#000";
	ctx.fillRect(0, 0, c.width, c.height);
	ctx.font = "11px sans-serif";
	return { c, ctx };
}

async function run() {
	// Comma-separated substrings; a shader runs if its path holds any of them.
	const filters = (new URLSearchParams(location.search).get("filter") ?? "")
		.toLowerCase()
		.split(",")
		.filter(Boolean);
	const files = Object.keys(fsFiles)
		.filter(
			(p) =>
				!filters.length || filters.some((f) => p.toLowerCase().includes(f)),
		)
		.sort();
	const results: VerifyResult[] = [];
	const sheets: string[] = [];
	const thumbs = files.length * (strip ? STRIP_AT.length : 1) + 1;
	let sheet = newSheet(Math.min(PER_SHEET, thumbs));
	let cell = 0;
	const thumb = (label: string, bad: boolean) => {
		const x = (cell % COLS) * THUMB_W;
		const y = Math.floor(cell / COLS) * (THUMB_H + 16);
		sheet.ctx.drawImage(canvas, x, y, THUMB_W, THUMB_H);
		sheet.ctx.fillStyle = bad ? "#ff5c5c" : "#d7dae0";
		sheet.ctx.fillText(label.slice(0, 40), x + 4, y + THUMB_H + 12);
		cell++;
		if (cell === PER_SHEET) {
			sheets.push(sheet.c.toDataURL("image/png"));
			sheet = newSheet(PER_SHEET);
			cell = 0;
		}
	};

	slotA.draw(1, cut ? 1 : 0);
	passthrough.render({}, { inputImage: slotA.binding }, 0, null, W, H);
	thumb("(source)", false);

	for (const path of files) {
		const name = path.replace("../shaders/", "").replace(/\.fs$/, "");
		const warnings: string[] = [];
		let effect: IsfEffect | undefined;
		try {
			const parsed = parseIsf(fsFiles[path]);
			effect = new IsfEffect(gl, parsed, vsFiles[path.replace(/\.fs$/, ".vs")]);
			const params: Record<string, ParamValue> = {};
			for (const input of parsed.header.INPUTS ?? [])
				if (input.TYPE !== "image") params[input.NAME] = defaultValue(input);
			if ("progress" in params) params.progress = 0.5;
			for (const [k, v] of overrides)
				if (k in params)
					params[k] = typeof params[k] === "boolean" ? v === "1" : Number(v);
			const imageNames = (parsed.header.INPUTS ?? [])
				.filter((i) => i.TYPE === "image")
				.map((i) => i.NAME);
			let ms = 0;
			for (let f = 0; f < FRAMES; f++) {
				const t = f / FPS;
				slotA.draw(t, cut && f >= FRAMES / 2 ? 1 : 0);
				slotB.draw(t);
				const images: Record<string, ImageBinding> = {};
				for (const n of imageNames)
					images[n] =
						n === "inputImage" || n === "startImage"
							? slotA.binding
							: slotB.binding;
				gl.viewport(0, 0, W, H);
				const t0 = performance.now();
				effect.render(params, images, t, null, W, H);
				if (f >= FRAMES - 10) {
					gl.readPixels(
						0,
						0,
						1,
						1,
						gl.RGBA,
						gl.UNSIGNED_BYTE,
						new Uint8Array(4),
					);
					ms += performance.now() - t0;
				}
				if (strip && STRIP_AT.includes(f) && f !== FRAMES - 1)
					thumb(`${name} @${f}`, false);
			}
			const glErr = gl.getError();
			if (glErr) warnings.push(`GL error 0x${glErr.toString(16)}`);
			const out = read();
			thumb(strip ? `${name} @${FRAMES - 1}` : name, false);
			passthrough.render({}, { inputImage: slotA.binding }, 0, null, W, H);
			const s = stats(out, read());
			if (s.stddev < 3)
				warnings.push(`flat output (stddev ${s.stddev.toFixed(1)})`);
			if (s.mean < 4) warnings.push("black output");
			if (s.diff < 0.75) warnings.push("no visible change at defaults");
			// Transitions may pass through black mid-way (Grid Flip's gaps).
			if (s.blackGain > 0.25 && !("progress" in params))
				warnings.push(
					`${Math.round(s.blackGain * 100)}% of pixels went black (NaN?)`,
				);
			results.push({
				name,
				ok: warnings.length === 0,
				warnings,
				diff: s.diff,
				stddev: s.stddev,
				ms: ms / 10,
			});
		} catch (e) {
			gl.clearColor(0.3, 0, 0, 1);
			gl.clear(gl.COLOR_BUFFER_BIT);
			thumb(name, true);
			results.push({
				name,
				ok: false,
				error: (e as Error).message,
				warnings,
				diff: 0,
				stddev: 0,
				ms: 0,
			});
		} finally {
			effect?.dispose();
		}
		await new Promise((r) => setTimeout(r));
	}
	if (cell) sheets.push(sheet.c.toDataURL("image/png"));
	document.getElementById("log")!.textContent = results
		.map(
			(r) =>
				`${r.ok ? "ok  " : "FAIL"} ${r.name}  ${r.ms.toFixed(1)}ms  Δ${r.diff.toFixed(1)}  ${r.error ?? r.warnings.join("; ")}`,
		)
		.join("\n");
	(window as unknown as { __verify: unknown }).__verify = { results, sheets };
}

run();
