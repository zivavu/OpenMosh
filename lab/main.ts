// Shader Lab: plays a video (or image / webcam) through ISF shaders so effects
// can be judged on real footage before anything is ported into the app.
// Dev only — open http://localhost:5173/lab/ with `bun dev`.

import {
	IsfEffect,
	parseIsf,
	defaultValue,
	type IsfHeader,
	type IsfInput,
	type ParamValue,
	type ImageBinding,
} from "./isf";

// --- Shader catalogue --------------------------------------------------------

const fsFiles = import.meta.glob("./shaders/**/*.fs", { query: "?raw", eager: true, import: "default" }) as Record<string, string>;
const vsFiles = import.meta.glob("./shaders/**/*.vs", { query: "?raw", eager: true, import: "default" }) as Record<string, string>;

interface Entry {
	id: string;
	name: string;
	group: string;
	header: IsfHeader;
	body: string;
	vs?: string;
	error?: string;
	imageInputs: string[];
}

function groupFor(path: string, header: IsfHeader): string {
	if (path.includes("/ported/")) {
		const credit = header.CREDIT ?? "";
		if (credit.includes("X-PostProcessing")) return "Ported · X-PostProcessing (MIT)";
		if (credit.includes("Acerola")) return "Ported · AcerolaFX (MIT)";
		if (credit.includes("Keijiro")) return "Ported · Kino (Unlicense/MIT)";
		if (credit.includes("godotshaders")) return "Ported · Godot (CC0)";
		return "Ported";
	}
	const cats = header.CATEGORIES ?? [];
	const primary =
		["Glitch", "Feedback", "Distortion", "Distortion Effect", "Retro", "Film", "Stylize", "Halftone Effect", "Tile Effect", "Kaleidoscope", "Blur", "Noise", "Color Effect", "Color"].find((c) => cats.includes(c)) ??
		cats[0] ??
		"Other";
	return `Vidvox · ${primary.replace(" Effect", "")}`;
}

const entries: Entry[] = Object.entries(fsFiles)
	.map(([path, src]) => {
		const name = path.split("/").pop()!.replace(/\.fs$/, "");
		try {
			const { header, body } = parseIsf(src);
			const imageInputs = (header.INPUTS ?? []).filter((i) => i.TYPE === "image").map((i) => i.NAME);
			return { id: path, name, group: groupFor(path, header), header, body, vs: vsFiles[path.replace(/\.fs$/, ".vs")], imageInputs };
		} catch (e) {
			return { id: path, name, group: "Broken", header: {}, body: "", error: String(e), imageInputs: [] };
		}
	})
	.sort((a, b) => a.group.localeCompare(b.group) || a.name.localeCompare(b.name));
// Ported shaders first — they are the point of the lab.
entries.sort((a, b) => Number(b.group.startsWith("Ported")) - Number(a.group.startsWith("Ported")));

// --- Persistence ---------------------------------------------------------------

const favs = new Set<string>(JSON.parse(localStorage.getItem("lab-favs") ?? "[]"));
const notes: Record<string, string> = JSON.parse(localStorage.getItem("lab-notes") ?? "{}");
const saveFavs = () => localStorage.setItem("lab-favs", JSON.stringify([...favs]));
const saveNotes = () => localStorage.setItem("lab-notes", JSON.stringify(notes));

// --- GL setup --------------------------------------------------------------------

const canvas = document.getElementById("gl") as HTMLCanvasElement;
const gl = canvas.getContext("webgl2", { preserveDrawingBuffer: true, antialias: false, premultipliedAlpha: false })!;
if (!gl) throw new Error("WebGL2 required");

function makeTexture(): WebGLTexture {
	const t = gl.createTexture()!;
	gl.bindTexture(gl.TEXTURE_2D, t);
	gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
	gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
	gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
	gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
	return t;
}

class MediaSlot {
	texture = makeTexture();
	width = 0;
	height = 0;
	video?: HTMLVideoElement;
	image?: HTMLImageElement;
	private lastTime = -1;
	private imageUploaded = false;

	constructor(private readonly onLoad?: () => void) {}

	get binding(): ImageBinding | undefined {
		return this.width ? { texture: this.texture, width: this.width, height: this.height } : undefined;
	}

	clear() {
		this.video?.pause();
		if (this.video?.srcObject) (this.video.srcObject as MediaStream).getTracks().forEach((t) => t.stop());
		this.video = undefined;
		this.image = undefined;
		this.width = this.height = 0;
		this.imageUploaded = false;
	}

	loadFile(file: File) {
		this.clear();
		const url = URL.createObjectURL(file);
		if (file.type.startsWith("image/")) {
			const img = new Image();
			img.onload = () => {
				this.image = img;
				this.width = img.naturalWidth;
				this.height = img.naturalHeight;
				this.onLoad?.();
			};
			img.src = url;
		} else {
			const v = document.createElement("video");
			v.src = url;
			v.loop = true;
			v.muted = true;
			v.playsInline = true;
			v.onloadedmetadata = () => {
				this.width = v.videoWidth;
				this.height = v.videoHeight;
				this.onLoad?.();
				v.play().catch(() => {});
			};
			this.video = v;
		}
	}

	async loadWebcam() {
		this.clear();
		const stream = await navigator.mediaDevices.getUserMedia({ video: { width: 1280, height: 720 }, audio: false });
		const v = document.createElement("video");
		v.srcObject = stream;
		v.muted = true;
		v.playsInline = true;
		v.onloadedmetadata = () => {
			this.width = v.videoWidth;
			this.height = v.videoHeight;
			this.onLoad?.();
			v.play().catch(() => {});
		};
		this.video = v;
	}

	// Uploads the current frame if there is a new one.
	upload() {
		gl.bindTexture(gl.TEXTURE_2D, this.texture);
		gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, true);
		if (this.video && this.video.readyState >= 2) {
			if (this.video.currentTime !== this.lastTime || this.video.srcObject) {
				this.lastTime = this.video.currentTime;
				gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, this.video);
			}
		} else if (this.image && !this.imageUploaded) {
			gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, this.image);
			this.imageUploaded = true;
		}
		gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false);
	}
}

const mediaA = new MediaSlot(() => {
	dropEl.classList.add("hidden");
	fitCanvas();
	current?.effect?.reset();
});
const mediaB = new MediaSlot();

// Bypass renders the source through the simplest possible ISF.
const passthrough = new IsfEffect(gl, parseIsf(`/*{"INPUTS":[{"NAME":"inputImage","TYPE":"image"}]}*/
void main(){ gl_FragColor = IMG_THIS_NORM_PIXEL(inputImage); }`));

// --- State -------------------------------------------------------------------

interface Current {
	entry: Entry;
	effect?: IsfEffect;
	params: Record<string, ParamValue>;
	events: Set<string>;
}
let current: Current | undefined;
let bypass = false;
let renderScale = 0.5;

const dropEl = document.getElementById("drop")!;
const stage = document.getElementById("stage")!;
const listEl = document.getElementById("list")!;
const paramsEl = document.getElementById("params")!;
const errorEl = document.getElementById("error")!;
const infoEl = document.getElementById("info")!;
const titleEl = document.getElementById("title")!;
const notesEl = document.getElementById("notes") as HTMLTextAreaElement;
const searchEl = document.getElementById("search") as HTMLInputElement;
const favOnlyBtn = document.getElementById("favOnly") as HTMLButtonElement;
const fpsEl = document.getElementById("fps")!;
const seekEl = document.getElementById("seek") as HTMLInputElement;
const playBtn = document.getElementById("play") as HTMLButtonElement;
const muteBtn = document.getElementById("mute") as HTMLButtonElement;

function fitCanvas() {
	const w = mediaA.width || 1280;
	const h = mediaA.height || 720;
	canvas.width = Math.max(2, Math.round(w * renderScale));
	canvas.height = Math.max(2, Math.round(h * renderScale));
	canvas.style.aspectRatio = `${w} / ${h}`;
}

function showError(msg?: string) {
	errorEl.textContent = msg ?? "";
	errorEl.classList.toggle("show", !!msg);
}

function select(entry: Entry) {
	current?.effect?.dispose();
	const params: Record<string, ParamValue> = {};
	for (const input of entry.header.INPUTS ?? []) if (input.TYPE !== "image") params[input.NAME] = defaultValue(input);
	current = { entry, params, events: new Set() };
	titleEl.textContent = entry.name;
	notesEl.value = notes[entry.id] ?? "";
	try {
		if (entry.error) throw new Error(entry.error);
		current.effect = new IsfEffect(gl, { header: entry.header, body: entry.body }, entry.vs);
		showError();
	} catch (e) {
		entry.error = (e as Error).message;
		showError(entry.error);
	}
	renderParams();
	renderInfo();
	renderList();
	location.hash = encodeURIComponent(entry.name);
	listEl.querySelector(".item.active")?.scrollIntoView({ block: "nearest" });
	scheduleNoopCheck();
}

// Many library shaders ship with amount/progress at 0 and look like a no-op.
// After a few frames, compare against the source; if nothing changed, push
// sliders sitting at their minimum to mid-range and say so.
let noopTimer = 0;
const scratch = { fbo: gl.createFramebuffer()!, tex: makeTexture(), w: 0, h: 0 };
function scheduleNoopCheck() {
	clearTimeout(noopTimer);
	noopTimer = window.setTimeout(checkNoop, 700);
}
function readCanvas(): Uint8Array {
	const px = new Uint8Array(canvas.width * canvas.height * 4);
	gl.bindFramebuffer(gl.FRAMEBUFFER, null);
	gl.readPixels(0, 0, canvas.width, canvas.height, gl.RGBA, gl.UNSIGNED_BYTE, px);
	return px;
}
function checkNoop() {
	const cur = current;
	const a = mediaA.binding;
	if (!cur?.effect || !a || bypass) return;
	const out = readCanvas();
	const { w, h } = { w: canvas.width, h: canvas.height };
	if (scratch.w !== w || scratch.h !== h) {
		gl.bindTexture(gl.TEXTURE_2D, scratch.tex);
		gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, w, h, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);
		gl.bindFramebuffer(gl.FRAMEBUFFER, scratch.fbo);
		gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, scratch.tex, 0);
		scratch.w = w;
		scratch.h = h;
	}
	passthrough.render({}, { inputImage: a }, performance.now() / 1000, scratch.fbo, w, h);
	const src = new Uint8Array(w * h * 4);
	gl.bindFramebuffer(gl.FRAMEBUFFER, scratch.fbo);
	gl.readPixels(0, 0, w, h, gl.RGBA, gl.UNSIGNED_BYTE, src);
	gl.bindFramebuffer(gl.FRAMEBUFFER, null);
	let diff = 0;
	let n = 0;
	for (let i = 0; i < out.length; i += 16) {
		diff += Math.abs(out[i] - src[i]) + Math.abs(out[i + 1] - src[i + 1]) + Math.abs(out[i + 2] - src[i + 2]);
		n += 3;
	}
	if (diff / n > 0.5) return;
	const bumped: string[] = [];
	for (const input of cur.entry.header.INPUTS ?? []) {
		if (input.TYPE === "event") {
			cur.events.add(input.NAME);
			continue;
		}
		if (input.TYPE !== "float") continue;
		const min = typeof input.MIN === "number" ? input.MIN : 0;
		const max = typeof input.MAX === "number" ? input.MAX : 1;
		const v = cur.params[input.NAME] as number;
		// Zero at the bottom of the range, or the neutral point of a bipolar one.
		if (v <= min || (min < 0 && max > 0 && v === 0)) {
			cur.params[input.NAME] = min + (max - min) * (min < 0 ? 0.7 : 0.5);
			bumped.push(input.LABEL ?? input.NAME);
		}
	}
	if (bumped.length) {
		renderParams();
		showError(`Defaults were a no-op on this footage — bumped to 50%: ${bumped.join(", ")}. Reset restores the originals.`);
	} else {
		showError("No visible change at these settings (needs motion, a second image, or specific colors).");
	}
}

// --- List ------------------------------------------------------------------------

let favOnly = false;
function renderList() {
	const q = searchEl.value.trim().toLowerCase();
	listEl.innerHTML = "";
	let lastGroup = "";
	for (const e of entries) {
		if (favOnly && !favs.has(e.id)) continue;
		if (q && !`${e.name} ${e.group} ${(e.header.CATEGORIES ?? []).join(" ")} ${e.header.DESCRIPTION ?? ""}`.toLowerCase().includes(q)) continue;
		if (e.group !== lastGroup) {
			const h = document.createElement("h4");
			h.textContent = e.group;
			listEl.appendChild(h);
			lastGroup = e.group;
		}
		const item = document.createElement("div");
		item.className = "item";
		if (current?.entry === e) item.classList.add("active");
		if (favs.has(e.id)) item.classList.add("fav");
		if (e.error) item.classList.add("bad");
		const star = document.createElement("span");
		star.className = "star";
		star.textContent = favs.has(e.id) ? "★" : "☆";
		star.onclick = (ev) => {
			ev.stopPropagation();
			toggleFav(e);
		};
		const name = document.createElement("span");
		name.className = "name";
		name.textContent = e.name;
		name.title = e.header.DESCRIPTION ?? "";
		const cats = document.createElement("span");
		cats.className = "cats";
		cats.textContent = e.header.PASSES?.length ? `${e.header.PASSES.length}p` : "";
		item.append(star, name, cats);
		item.onclick = () => select(e);
		listEl.appendChild(item);
	}
}

function toggleFav(e: Entry) {
	if (favs.has(e.id)) favs.delete(e.id);
	else favs.add(e.id);
	saveFavs();
	renderList();
}

// --- Params UI ---------------------------------------------------------------------

function fmt(v: number) {
	return Math.abs(v) >= 100 ? v.toFixed(0) : Math.abs(v) >= 10 ? v.toFixed(1) : v.toFixed(3);
}

function renderParams() {
	paramsEl.innerHTML = "";
	if (!current) return;
	const { params, events } = current;
	for (const input of current.entry.header.INPUTS ?? []) {
		if (input.TYPE === "image") {
			if (input.NAME === "inputImage") continue;
			const d = document.createElement("div");
			d.className = "ctl";
			d.innerHTML = `<label>${input.NAME} <span class="val">${input.NAME === "startImage" ? "← media A" : "← media B"}</span></label>`;
			paramsEl.appendChild(d);
			continue;
		}
		const label = input.LABEL ?? input.NAME;
		const wrap = document.createElement("div");
		wrap.className = "ctl";
		switch (input.TYPE) {
			case "float": {
				const min = typeof input.MIN === "number" ? input.MIN : 0;
				const max = typeof input.MAX === "number" ? input.MAX : 1;
				const val = document.createElement("span");
				val.className = "val";
				val.textContent = fmt(params[input.NAME] as number);
				const lab = document.createElement("label");
				lab.append(label, val);
				const r = document.createElement("input");
				r.type = "range";
				r.min = String(min);
				r.max = String(max);
				r.step = String((max - min) / 1000);
				r.value = String(params[input.NAME]);
				r.oninput = () => {
					params[input.NAME] = Number(r.value);
					val.textContent = fmt(Number(r.value));
				};
				wrap.append(lab, r);
				break;
			}
			case "long": {
				if (input.VALUES && input.VALUES.length) {
					const lab = document.createElement("label");
					lab.textContent = label;
					const s = document.createElement("select");
					input.VALUES.forEach((v, i) => {
						const o = document.createElement("option");
						o.value = String(v);
						o.textContent = input.LABELS?.[i] ?? String(v);
						s.appendChild(o);
					});
					s.value = String(params[input.NAME]);
					s.onchange = () => (params[input.NAME] = Number(s.value));
					wrap.append(lab, s);
				} else {
					const min = typeof input.MIN === "number" ? input.MIN : 0;
					const max = typeof input.MAX === "number" ? input.MAX : 10;
					const val = document.createElement("span");
					val.className = "val";
					val.textContent = String(params[input.NAME]);
					const lab = document.createElement("label");
					lab.append(label, val);
					const r = document.createElement("input");
					r.type = "range";
					r.min = String(min);
					r.max = String(max);
					r.step = "1";
					r.value = String(params[input.NAME]);
					r.oninput = () => {
						params[input.NAME] = Number(r.value);
						val.textContent = r.value;
					};
					wrap.append(lab, r);
				}
				break;
			}
			case "bool": {
				wrap.classList.add("row");
				const c = document.createElement("input");
				c.type = "checkbox";
				c.checked = !!params[input.NAME];
				c.onchange = () => (params[input.NAME] = c.checked);
				const lab = document.createElement("label");
				lab.textContent = label;
				wrap.append(c, lab);
				break;
			}
			case "event": {
				const b = document.createElement("button");
				b.textContent = label;
				b.onclick = () => events.add(input.NAME);
				wrap.append(b);
				break;
			}
			case "color": {
				wrap.classList.add("row");
				const v = params[input.NAME] as number[];
				const c = document.createElement("input");
				c.type = "color";
				c.value = rgbToHex(v);
				const a = document.createElement("input");
				a.type = "range";
				a.min = "0";
				a.max = "1";
				a.step = "0.01";
				a.value = String(v[3] ?? 1);
				a.title = "alpha";
				a.style.width = "70px";
				const lab = document.createElement("label");
				lab.textContent = label;
				const update = () => {
					const rgb = hexToRgb(c.value);
					params[input.NAME] = [rgb[0], rgb[1], rgb[2], Number(a.value)];
				};
				c.oninput = update;
				a.oninput = update;
				wrap.append(c, a, lab);
				break;
			}
			case "point2D": {
				const v = params[input.NAME] as number[];
				const min = Array.isArray(input.MIN) ? input.MIN : [0, 0];
				const max = Array.isArray(input.MAX) ? input.MAX : [1, 1];
				const lab = document.createElement("label");
				lab.textContent = label;
				wrap.append(lab);
				for (const axis of [0, 1]) {
					const r = document.createElement("input");
					r.type = "range";
					r.min = String(min[axis]);
					r.max = String(max[axis]);
					r.step = String((max[axis] - min[axis]) / 1000);
					r.value = String(v[axis]);
					r.oninput = () => ((params[input.NAME] as number[])[axis] = Number(r.value));
					wrap.append(r);
				}
				break;
			}
			default: {
				wrap.innerHTML = `<label>${label} <span class="val">unsupported ${input.TYPE}</span></label>`;
			}
		}
		paramsEl.appendChild(wrap);
	}
}

function rgbToHex(v: number[]) {
	return "#" + v.slice(0, 3).map((x) => Math.round(Math.min(1, Math.max(0, x)) * 255).toString(16).padStart(2, "0")).join("");
}
function hexToRgb(h: string) {
	return [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16) / 255);
}

function renderInfo() {
	if (!current) return;
	const h = current.entry.header;
	const src = h.SOURCE ? `<a href="${h.SOURCE}" target="_blank" rel="noreferrer">source</a>` : "";
	infoEl.innerHTML = `
		<div class="desc">${escapeHtml(h.DESCRIPTION ?? "")}</div>
		<div><b>Credit:</b> ${escapeHtml(h.CREDIT ?? "—")}</div>
		<div><b>License:</b> ${escapeHtml(h.LICENSE ?? (current.entry.id.includes("/vidvox/") ? "MIT (Vidvox ISF-Files)" : "—"))} ${src}</div>
		<div><b>Categories:</b> ${escapeHtml((h.CATEGORIES ?? []).join(", "))}</div>
		${h.PASSES?.length ? `<div><b>Passes:</b> ${h.PASSES.map((p) => p.TARGET ? `${p.TARGET}${p.PERSISTENT ? "*" : ""}` : "out").join(" → ")}</div>` : ""}
	`;
}
function escapeHtml(s: string) {
	return s.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]!);
}

// --- Render loop -----------------------------------------------------------------------

let frames = 0;
let lastFpsTime = performance.now();
let frameMs = 0;

function frame(now: number) {
	requestAnimationFrame(frame);
	mediaA.upload();
	mediaB.upload();
	const a = mediaA.binding;
	if (!a) return;
	const t0 = performance.now();
	const images: Record<string, ImageBinding> = { inputImage: a, startImage: a };
	const b = mediaB.binding;
	if (current) for (const n of current.entry.imageInputs) if (n !== "inputImage" && n !== "startImage" && b) images[n] = b;
	gl.viewport(0, 0, canvas.width, canvas.height);
	const effect = bypass || !current?.effect ? passthrough : current.effect;
	const params = { ...(current?.params ?? {}) };
	if (current) {
		for (const ev of current.events) params[ev] = true;
		current.events.clear();
	}
	try {
		effect.render(params, images, now / 1000, null, canvas.width, canvas.height);
	} catch (e) {
		showError(String(e));
	}
	frameMs = frameMs * 0.9 + (performance.now() - t0) * 0.1;
	frames++;
	if (now - lastFpsTime > 500) {
		fpsEl.textContent = `${Math.round((frames * 1000) / (now - lastFpsTime))} fps · ${frameMs.toFixed(1)} ms`;
		frames = 0;
		lastFpsTime = now;
	}
	if (mediaA.video && !mediaA.video.srcObject && mediaA.video.duration) {
		seekEl.value = String(mediaA.video.currentTime / mediaA.video.duration);
		playBtn.textContent = mediaA.video.paused ? "Play" : "Pause";
	}
}
requestAnimationFrame(frame);

// --- Wiring -------------------------------------------------------------------------------

const fileEl = document.getElementById("file") as HTMLInputElement;
const fileBEl = document.getElementById("fileB") as HTMLInputElement;
document.getElementById("loadMedia")!.onclick = () => fileEl.click();
document.getElementById("loadB")!.onclick = () => fileBEl.click();
fileEl.onchange = () => fileEl.files?.[0] && mediaA.loadFile(fileEl.files[0]);
fileBEl.onchange = () => fileBEl.files?.[0] && mediaB.loadFile(fileBEl.files[0]);
document.getElementById("webcam")!.onclick = () => mediaA.loadWebcam().catch((e) => showError(String(e)));

stage.ondragover = (e) => {
	e.preventDefault();
	stage.classList.add("dragover");
};
stage.ondragleave = () => stage.classList.remove("dragover");
stage.ondrop = (e) => {
	e.preventDefault();
	stage.classList.remove("dragover");
	const f = e.dataTransfer?.files?.[0];
	if (f) (e.shiftKey ? mediaB : mediaA).loadFile(f);
};

playBtn.onclick = () => {
	const v = mediaA.video;
	if (!v) return;
	v.paused ? v.play() : v.pause();
};
seekEl.oninput = () => {
	const v = mediaA.video;
	if (v && v.duration) v.currentTime = Number(seekEl.value) * v.duration;
};
muteBtn.onclick = () => {
	const v = mediaA.video;
	if (!v) return;
	v.muted = !v.muted;
	muteBtn.textContent = v.muted ? "Muted" : "Sound";
	muteBtn.classList.toggle("on", v.muted);
};
(document.getElementById("scale") as HTMLSelectElement).onchange = (e) => {
	renderScale = Number((e.target as HTMLSelectElement).value);
	fitCanvas();
	current?.effect?.reset();
};
const bypassBtn = document.getElementById("bypass")!;
const setBypass = (on: boolean) => {
	bypass = on;
	bypassBtn.classList.toggle("on", on);
};
bypassBtn.onpointerdown = () => setBypass(true);
bypassBtn.onpointerup = bypassBtn.onpointerleave = () => setBypass(false);

document.getElementById("reset")!.onclick = () => current && resetCurrent();
function resetCurrent() {
	if (!current) return;
	for (const input of current.entry.header.INPUTS ?? []) if (input.TYPE !== "image") current.params[input.NAME] = defaultValue(input);
	current.effect?.reset();
	renderParams();
}
document.getElementById("random")!.onclick = () => {
	if (!current) return;
	for (const input of current.entry.header.INPUTS ?? []) {
		if (input.TYPE === "float") {
			const min = typeof input.MIN === "number" ? input.MIN : 0;
			const max = typeof input.MAX === "number" ? input.MAX : 1;
			current.params[input.NAME] = min + Math.random() * (max - min);
		} else if (input.TYPE === "long" && input.VALUES?.length) {
			current.params[input.NAME] = input.VALUES[Math.floor(Math.random() * input.VALUES.length)];
		} else if (input.TYPE === "bool") {
			current.params[input.NAME] = Math.random() < 0.5;
		}
	}
	renderParams();
};

searchEl.oninput = renderList;
favOnlyBtn.onclick = () => {
	favOnly = !favOnly;
	favOnlyBtn.classList.toggle("on", favOnly);
	renderList();
};
notesEl.oninput = () => {
	if (!current) return;
	if (notesEl.value.trim()) notes[current.entry.id] = notesEl.value;
	else delete notes[current.entry.id];
	saveNotes();
};

document.getElementById("compileAll")!.onclick = () => {
	let bad = 0;
	for (const e of entries) {
		if (e.error) {
			bad++;
			continue;
		}
		try {
			new IsfEffect(gl, { header: e.header, body: e.body }, e.vs).dispose();
		} catch (err) {
			e.error = (err as Error).message;
			bad++;
		}
	}
	renderList();
	showError(bad ? `${bad} of ${entries.length} shaders failed to compile — they are marked red. Select one to see its log.` : `All ${entries.length} shaders compile.`);
};

document.getElementById("exportList")!.onclick = async () => {
	const lines = ["# Shader lab shortlist", ""];
	for (const e of entries) {
		if (!favs.has(e.id) && !notes[e.id]) continue;
		lines.push(`## ${favs.has(e.id) ? "★ " : ""}${e.name}`);
		lines.push(`- Group: ${e.group}`);
		if (e.header.SOURCE) lines.push(`- Source: ${e.header.SOURCE}`);
		if (e.header.LICENSE) lines.push(`- License: ${e.header.LICENSE}`);
		if (e.header.DESCRIPTION) lines.push(`- ${e.header.DESCRIPTION}`);
		if (notes[e.id]) lines.push("", notes[e.id].trim());
		lines.push("");
	}
	await navigator.clipboard.writeText(lines.join("\n"));
	showError("Shortlist copied to clipboard as markdown.");
};

window.addEventListener("keydown", (e) => {
	if ((e.target as HTMLElement).matches("input, textarea, select")) return;
	const visible = [...listEl.querySelectorAll<HTMLElement>(".item")];
	const idx = visible.findIndex((el) => el.classList.contains("active"));
	if (e.key === "ArrowDown" || e.key === "ArrowUp") {
		e.preventDefault();
		const next = visible[Math.min(visible.length - 1, Math.max(0, idx + (e.key === "ArrowDown" ? 1 : -1)))];
		next?.click();
		next?.scrollIntoView({ block: "nearest" });
	} else if (e.key === " ") {
		e.preventDefault();
		playBtn.click();
	} else if (e.key.toLowerCase() === "f" && current) toggleFav(current.entry);
	else if (e.key.toLowerCase() === "b") setBypass(true);
	else if (e.key.toLowerCase() === "r") resetCurrent();
});
window.addEventListener("keyup", (e) => {
	if (e.key.toLowerCase() === "b") setBypass(false);
});

// --- Boot --------------------------------------------------------------------------------------

// Debug hook for the Playwright harness.
(window as unknown as { __lab: unknown }).__lab = {
	entries,
	select,
	get current() { return current; },
	setBypass,
	gl,
	canvas,
	mediaA,
};

fitCanvas();
renderList();
const wanted = decodeURIComponent(location.hash.slice(1));
select(entries.find((e) => e.name === wanted) ?? entries[0]);
