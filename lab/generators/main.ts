// Generator Lab: auditions procedural image generators before any of them is
// ported into src/lib/generators. Dev only: localhost:5173/lab/generators/ (`bun dev`).

import { GENERATORS } from "./gens";
import {
	ctx2d,
	makeCanvas,
	mulberry32,
	PALETTE_NAMES,
	paletteFor,
	type Generator,
	type Param,
	type Values,
} from "./kit";

interface State {
	gen: string;
	seed: number;
	palette: string;
	ratio: string;
	size: number;
	values: Record<string, Values>;
}

const STORE = "genlab-state";
const saved: Partial<State> = JSON.parse(localStorage.getItem(STORE) ?? "{}");
const state: State = {
	gen: saved.gen ?? GENERATORS[0].id,
	seed: saved.seed ?? 1,
	palette: saved.palette ?? "Random",
	ratio: saved.ratio ?? "16:9",
	size: saved.size ?? 1080,
	values: saved.values ?? {},
};
const save = () => localStorage.setItem(STORE, JSON.stringify(state));

const favs = new Set<string>(
	JSON.parse(localStorage.getItem("genlab-favs") ?? "[]"),
);
const notes: Record<string, string> = JSON.parse(
	localStorage.getItem("genlab-notes") ?? "{}",
);

const $ = <T extends HTMLElement>(id: string) =>
	document.getElementById(id) as T;
const stage = $("stage");
const listEl = $("list");
const paramsEl = $("params");
const errorEl = $("error");
const infoEl = $("info");
const titleEl = $("title");
const notesEl = $<HTMLTextAreaElement>("notes");
const seedEl = $<HTMLInputElement>("seed");
const paletteEl = $<HTMLSelectElement>("palette");
const ratioEl = $<HTMLSelectElement>("ratio");
const sizeEl = $<HTMLSelectElement>("size");
const sheetBtn = $("sheetBtn");
const timeEl = $("time");
const busyEl = $("busy");

let sheet = false;
let shown: HTMLCanvasElement | null = null;

const current = (): Generator =>
	GENERATORS.find((g) => g.id === state.gen) ?? GENERATORS[0];

function defaults(g: Generator): Values {
	return Object.fromEntries(g.params.map((p) => [p.key, p.value]));
}

function valuesFor(g: Generator): Values {
	const v = { ...defaults(g), ...state.values[g.id] };
	state.values[g.id] = v;
	return v;
}

function size(short: number): { w: number; h: number } {
	const [a, b] = state.ratio.split(":").map(Number);
	return a >= b
		? { w: Math.round((short * a) / b), h: short }
		: { w: short, h: Math.round((short * b) / a) };
}

function renderOne(
	g: Generator,
	seed: number,
	short: number,
): { canvas: HTMLCanvasElement; ms: number } {
	const { w, h } = size(short);
	const canvas = makeCanvas(w, h);
	const ctx = ctx2d(canvas);
	const t0 = performance.now();
	g.render(
		{
			ctx,
			w,
			h,
			u: Math.min(w, h),
			s: Math.min(w, h) / 1080,
			rng: mulberry32(seed),
			seed,
			inks: paletteFor(state.palette, seed),
		},
		valuesFor(g),
	);
	return { canvas, ms: performance.now() - t0 };
}

function showError(msg?: string) {
	errorEl.textContent = msg ?? "";
	errorEl.classList.toggle("show", !!msg);
}

let token = 0;
let timer = 0;
function draw(delay = 0) {
	clearTimeout(timer);
	const mine = ++token;
	busyEl.classList.add("show");
	timer = window.setTimeout(() => {
		// Two frames so "rendering…" paints before the main thread blocks.
		requestAnimationFrame(() =>
			requestAnimationFrame(() => {
				if (mine !== token) return;
				try {
					showError();
					const g = current();
					if (sheet) {
						stage.className = "sheet";
						stage.innerHTML = "";
						let total = 0;
						for (let i = 0; i < 9; i++) {
							const seed = state.seed + i;
							const { canvas, ms } = renderOne(
								g,
								seed,
								Math.min(state.size, 360),
							);
							total += ms;
							const cell = document.createElement("div");
							cell.className = "cell";
							const tag = document.createElement("span");
							tag.textContent = String(seed);
							cell.append(canvas, tag);
							cell.onclick = () => {
								setSeed(seed);
								setSheet(false);
							};
							stage.appendChild(cell);
						}
						shown = null;
						timeEl.textContent = `9 × ${(total / 9).toFixed(0)} ms`;
					} else {
						stage.className = "";
						const { canvas, ms } = renderOne(g, state.seed, state.size);
						stage.replaceChildren(canvas);
						shown = canvas;
						timeEl.textContent = `${canvas.width}×${canvas.height} · ${ms.toFixed(0)} ms`;
					}
				} catch (e) {
					showError(String((e as Error).stack ?? e));
				}
				busyEl.classList.remove("show");
			}),
		);
	}, delay);
}

function setSeed(seed: number) {
	state.seed = Math.max(0, Math.floor(seed)) >>> 0;
	seedEl.value = String(state.seed);
	save();
	draw();
}

function setSheet(on: boolean) {
	sheet = on;
	sheetBtn.classList.toggle("on", on);
	draw();
}

function select(g: Generator) {
	state.gen = g.id;
	save();
	titleEl.textContent = g.name;
	infoEl.textContent = g.blurb;
	notesEl.value = notes[g.id] ?? "";
	location.hash = g.id;
	renderList();
	renderParams();
	draw();
}

function renderList() {
	listEl.innerHTML = "";
	let group = "";
	for (const g of GENERATORS) {
		if (g.group !== group) {
			const h = document.createElement("h4");
			h.textContent = group = g.group;
			listEl.appendChild(h);
		}
		const item = document.createElement("div");
		item.className = "item";
		item.classList.toggle("active", g.id === state.gen);
		item.classList.toggle("fav", favs.has(g.id));
		const star = document.createElement("span");
		star.className = "star";
		star.textContent = favs.has(g.id) ? "★" : "☆";
		star.onclick = (e) => {
			e.stopPropagation();
			toggleFav(g);
		};
		const name = document.createElement("span");
		name.className = "name";
		name.textContent = g.name;
		name.title = g.blurb;
		item.append(star, name);
		item.onclick = () => select(g);
		listEl.appendChild(item);
	}
}

function toggleFav(g: Generator) {
	if (favs.has(g.id)) favs.delete(g.id);
	else favs.add(g.id);
	localStorage.setItem("genlab-favs", JSON.stringify([...favs]));
	renderList();
}

function fmt(v: number, p: Extract<Param, { type: "range" }>) {
	if (p.step && p.step >= 1) return String(Math.round(v));
	return Math.abs(v) >= 10 ? v.toFixed(1) : v.toFixed(3);
}

function renderParams() {
	const g = current();
	const values = valuesFor(g);
	paramsEl.innerHTML = "";
	const changed = () => {
		save();
		draw(120);
	};
	for (const p of g.params) {
		const wrap = document.createElement("div");
		wrap.className = "ctl";
		const lab = document.createElement("label");
		if (p.type === "range") {
			const val = document.createElement("span");
			val.className = "val";
			val.textContent = fmt(values[p.key] as number, p);
			lab.append(p.label, val);
			const r = document.createElement("input");
			r.type = "range";
			r.min = String(p.min);
			r.max = String(p.max);
			r.step = String(p.step ?? (p.max - p.min) / 500);
			r.value = String(values[p.key]);
			r.oninput = () => {
				values[p.key] = Number(r.value);
				val.textContent = fmt(Number(r.value), p);
				changed();
			};
			wrap.append(lab, r);
		} else if (p.type === "select") {
			lab.textContent = p.label;
			const s = document.createElement("select");
			for (const o of p.options) s.add(new Option(o, o));
			s.value = String(values[p.key]);
			s.onchange = () => {
				values[p.key] = s.value;
				changed();
			};
			wrap.append(lab, s);
		} else {
			wrap.classList.add("row");
			const c = document.createElement("input");
			c.type = "checkbox";
			c.checked = !!values[p.key];
			c.onchange = () => {
				values[p.key] = c.checked;
				changed();
			};
			lab.textContent = p.label;
			wrap.append(c, lab);
		}
		paramsEl.appendChild(wrap);
	}
}

function shuffleKnobs() {
	const g = current();
	const values = valuesFor(g);
	for (const p of g.params) {
		if (p.type === "range") {
			const raw = p.min + Math.random() * (p.max - p.min);
			values[p.key] = p.step ? Math.round(raw / p.step) * p.step : raw;
		} else if (p.type === "select")
			values[p.key] = p.options[Math.floor(Math.random() * p.options.length)];
		else values[p.key] = Math.random() < 0.5;
	}
	save();
	renderParams();
	draw();
}

function resetKnobs() {
	const g = current();
	state.values[g.id] = defaults(g);
	save();
	renderParams();
	draw();
}

async function download() {
	const g = current();
	const canvas = shown ?? renderOne(g, state.seed, state.size).canvas;
	const blob = await new Promise<Blob | null>((r) =>
		canvas.toBlob(r, "image/png"),
	);
	if (!blob) return;
	const a = document.createElement("a");
	a.href = URL.createObjectURL(blob);
	a.download = `${g.id}-${state.seed}.png`;
	a.click();
	setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}

for (const name of PALETTE_NAMES) paletteEl.add(new Option(name, name));
paletteEl.value = state.palette;
ratioEl.value = state.ratio;
sizeEl.value = String(state.size);
seedEl.value = String(state.seed);

paletteEl.onchange = () => {
	state.palette = paletteEl.value;
	save();
	draw();
};
ratioEl.onchange = () => {
	state.ratio = ratioEl.value;
	save();
	draw();
};
sizeEl.onchange = () => {
	state.size = Number(sizeEl.value);
	save();
	draw();
};
seedEl.onchange = () => setSeed(Number(seedEl.value));
const step = (d: number) => setSeed(state.seed + d * (sheet ? 9 : 1));
$("prev").onclick = () => step(-1);
$("next").onclick = () => step(1);
$("reroll").onclick = () => setSeed(Math.floor(Math.random() * 1e6));
sheetBtn.onclick = () => setSheet(!sheet);
$("download").onclick = download;
$("reset").onclick = resetKnobs;
$("random").onclick = shuffleKnobs;
notesEl.oninput = () => {
	const g = current();
	if (notesEl.value.trim()) notes[g.id] = notesEl.value;
	else delete notes[g.id];
	localStorage.setItem("genlab-notes", JSON.stringify(notes));
};

$("exportList").onclick = async () => {
	const lines = ["# Generator lab shortlist", ""];
	for (const g of GENERATORS) {
		if (!favs.has(g.id) && !notes[g.id]) continue;
		lines.push(`## ${favs.has(g.id) ? "★ " : ""}${g.name}`, "");
		if (notes[g.id]) lines.push(notes[g.id].trim(), "");
		lines.push("```json", JSON.stringify(valuesFor(g)), "```", "");
	}
	await navigator.clipboard.writeText(lines.join("\n"));
	showError("Shortlist copied to the clipboard as markdown.");
};

window.addEventListener("keydown", (e) => {
	if ((e.target as HTMLElement).matches("input, textarea, select")) return;
	const i = GENERATORS.findIndex((g) => g.id === state.gen);
	const key = e.key.toLowerCase();
	if (e.key === "ArrowDown" || e.key === "ArrowUp") {
		e.preventDefault();
		const next =
			GENERATORS[
				(i + (e.key === "ArrowDown" ? 1 : -1) + GENERATORS.length) %
					GENERATORS.length
			];
		select(next);
	} else if (e.key === "ArrowLeft") step(-1);
	else if (e.key === "ArrowRight") step(1);
	else if (e.key === " ") {
		e.preventDefault();
		setSeed(Math.floor(Math.random() * 1e6));
	} else if (key === "g") setSheet(!sheet);
	else if (key === "x") shuffleKnobs();
	else if (key === "r") resetKnobs();
	else if (key === "f") toggleFav(current());
	else if (key === "d") download();
});

const wanted = GENERATORS.find((g) => g.id === location.hash.slice(1));
select(wanted ?? current());

// Debug hook for a headless smoke run.
(window as unknown as { __genlab: unknown }).__genlab = {
	GENERATORS,
	renderOne,
	state,
};
