// Music Lab: visuals computed from the song, to judge their look, their speed and how
// they follow the music before anything goes into the app. Dev only:
// localhost:5173/lab/music/ (`bun dev`).

import { analyzeDrive } from "./analyze";
import { ARCS_VISUAL } from "./arcs/visual";
import type { SongAudio } from "./listen";
import { PULSAR_VISUAL } from "./pulsar/visual";
import type { MusicVisual, VisualRun, VisualSettings } from "./visual";
import { decodeAudioFile } from "../../src/lib/audio/offline-audio";
import type { MixSegment } from "../../src/lib/mix/plan";
import { renderDrive } from "../../src/lib/mix/render";
import { GpuTimer } from "./gpu-timer";

const VISUALS: MusicVisual[] = [PULSAR_VISUAL, ARCS_VISUAL];
const RATIOS: Record<string, [number, number]> = {
	"4:5": [4, 5],
	"9:16": [9, 16],
	"1:1": [1, 1],
	"16:9": [16, 9],
};
const STORE = "musiclab-state";

interface VisualState {
	palette: string;
	values: Record<string, number>;
}

interface State {
	visual: string;
	seed: number;
	ratio: string;
	short: number;
	looks: Record<string, VisualState>;
}

/** What the lab saved before it had more than Arcs. */
interface ArcsOnlyState {
	palette?: string;
	values?: Record<string, number>;
}

const saved: Partial<State> & ArcsOnlyState = JSON.parse(
	localStorage.getItem(STORE) ?? "{}",
);
const state: State = {
	visual: saved.visual ?? VISUALS[0].id,
	seed: saved.seed ?? 1,
	ratio: saved.ratio ?? "4:5",
	short: saved.short ?? 720,
	looks:
		saved.looks ??
		(saved.values
			? { arcs: { palette: saved.palette ?? "Ice", values: saved.values } }
			: {}),
};
const save = () => localStorage.setItem(STORE, JSON.stringify(state));

let visual = VISUALS.find((v) => v.id === state.visual) ?? VISUALS[0];

const defaults = (v: MusicVisual) =>
	Object.fromEntries(v.knobs.map((k) => [k.key, k.value]));

for (const v of VISUALS) {
	const kept = state.looks[v.id];
	state.looks[v.id] = {
		palette: kept && v.palettes[kept.palette] ? kept.palette : v.defaultPalette,
		values: { ...defaults(v), ...kept?.values },
	};
}
const lookOf = (v: MusicVisual) => state.looks[v.id];

const settings = (): VisualSettings => ({
	seed: state.seed,
	...lookOf(visual),
});

interface Lane {
	id: string;
	name: string;
	buffer: AudioBuffer;
	drives: boolean;
}

const $ = <T extends HTMLElement>(id: string) =>
	document.getElementById(id) as T;
const canvas = $<HTMLCanvasElement>("view");
const strip = $<HTMLCanvasElement>("strip");
const playhead = $("playhead");
const overlay = $("overlay");
const hud = $("hud");
const errorEl = $("error");

const gl = canvas.getContext("webgl2", {
	antialias: false,
	alpha: false,
	powerPreference: "high-performance",
})!;
const timer = new GpuTimer(gl);
const runs = new Map<string, VisualRun>();
const lanes: Lane[] = [];
let song: SongAudio | null = null;
let run: VisualRun | null = null;
/** Whether `run` holds a table for the current song. */
let built = false;
let analyzeMs = 0;
let dirty = false;

function showError(e: unknown) {
	errorEl.textContent = String((e as Error)?.stack ?? e);
	errorEl.classList.add("show");
}

// ---- Transport: every lane is heard; only the driving ones feed the visuals.
let audio: AudioContext | null = null;
let sources: AudioBufferSourceNode[] = [];
let playing = false;
let startedAt = 0;
let pausedAt = 0;

const songLength = () => Math.max(0, ...lanes.map((l) => l.buffer.duration));
const now = () => (playing && audio ? audio.currentTime - startedAt : pausedAt);

function stopSources() {
	for (const s of sources) {
		s.onended = null;
		s.stop();
		s.disconnect();
	}
	sources = [];
}

async function play() {
	if (playing || !lanes.length) return;
	audio ??= new AudioContext();
	await audio.resume();
	if (pausedAt >= songLength()) pausedAt = 0;
	const at = audio.currentTime + 0.05;
	startedAt = at - pausedAt;
	for (const lane of lanes) {
		if (pausedAt >= lane.buffer.duration) continue;
		const node = audio.createBufferSource();
		node.buffer = lane.buffer;
		node.connect(audio.destination);
		node.start(at, pausedAt);
		sources.push(node);
	}
	playing = true;
	syncPlayButton();
}

function pause() {
	if (!playing) return;
	pausedAt = now();
	playing = false;
	stopSources();
	syncPlayButton();
	dirty = true;
}

function seek(t: number) {
	const wasPlaying = playing;
	pause();
	pausedAt = Math.max(0, Math.min(songLength(), t));
	dirty = true;
	if (wasPlaying) void play();
}

function syncPlayButton() {
	$("play").textContent = playing ? "Pause" : "Play";
}

// ---- Song: renderDrive is what the app's audio links hear, Drives lanes only.
let analysisToken = 0;

function drivePlan(): MixSegment[] {
	return lanes.map((lane) => ({
		laneId: lane.id,
		clipId: lane.id,
		sourceId: lane.id,
		drives: lane.drives,
		start: 0,
		end: lane.buffer.duration,
		offset: 0,
		rate: 1,
		gain: 1,
		fade: { start: 0, end: lane.buffer.duration, fadeIn: 0, fadeOut: 0 },
	}));
}

async function reanalyze() {
	const mine = ++analysisToken;
	song = null;
	built = false;
	syncOverlay();
	renderLanes();
	try {
		const t0 = performance.now();
		const drive = await renderDrive(
			drivePlan(),
			(id) => lanes.find((l) => l.id === id)?.buffer ?? null,
			songLength(),
		);
		if (mine !== analysisToken) return;
		if (!drive) {
			syncOverlay();
			return;
		}
		overlay.textContent = "Reading the song…";
		const analysed = await analyzeDrive(drive, (p) => {
			if (mine === analysisToken) {
				overlay.textContent = `Reading the song… ${Math.round(p * 100)}%`;
			}
		});
		if (mine !== analysisToken) return;
		song = analysed;
		analyzeMs = performance.now() - t0;
		rebuild();
	} catch (e) {
		showError(e);
	}
	syncOverlay();
}

function rebuild() {
	if (!song || !run) return;
	run.build(song, settings());
	built = true;
	drawStrip();
	dirty = true;
}

function startVisual() {
	errorEl.classList.remove("show");
	run = runs.get(visual.id) ?? null;
	if (!run) {
		try {
			run = visual.start(gl);
			runs.set(visual.id, run);
		} catch (e) {
			showError(e);
		}
	}
	built = false;
	rebuild();
	syncOverlay();
}

function syncOverlay() {
	const message = !lanes.length
		? "Drop a track to start. There's no picture without one."
		: !lanes.some((l) => l.drives)
			? "No lane has Drives on, so nothing moves the picture."
			: !built
				? "Reading the song…"
				: "";
	overlay.textContent = message;
	overlay.classList.toggle("show", !!message);
	canvas.classList.toggle("off", !built);
}

async function addFiles(files: Iterable<File>) {
	for (const file of files) {
		try {
			const buffer = await decodeAudioFile(file);
			lanes.push({
				id: crypto.randomUUID(),
				name: file.name,
				buffer,
				drives: !lanes.some((l) => l.drives),
			});
		} catch (e) {
			showError(`${file.name}: ${String(e)}`);
		}
	}
	pause();
	await reanalyze();
}

function renderLanes() {
	const el = $("lanes");
	el.replaceChildren();
	for (const lane of lanes) {
		const row = document.createElement("label");
		row.className = "lane";
		const box = document.createElement("input");
		box.type = "checkbox";
		box.checked = lane.drives;
		box.title = "Drives the visuals";
		box.onchange = () => {
			lane.drives = box.checked;
			void reanalyze();
		};
		const name = document.createElement("span");
		name.textContent = lane.name;
		name.title = lane.name;
		const remove = document.createElement("button");
		remove.textContent = "×";
		remove.title = "Remove lane";
		remove.onclick = (e) => {
			e.preventDefault();
			lanes.splice(lanes.indexOf(lane), 1);
			pause();
			pausedAt = Math.min(pausedAt, songLength());
			void reanalyze();
		};
		row.append(box, name, remove);
		el.append(row);
	}
}

// ---- Picture
function size() {
	const [a, b] = RATIOS[state.ratio] ?? RATIOS["4:5"];
	return a >= b
		? { w: Math.round((state.short * a) / b) & ~1, h: state.short }
		: { w: state.short, h: Math.round((state.short * b) / a) & ~1 };
}

/** The whole picture is a function of `t`: this is the only place time enters it. */
function drawAt(t: number) {
	if (!run || !built) return;
	const { w, h } = size();
	if (canvas.width !== w || canvas.height !== h) {
		canvas.width = w;
		canvas.height = h;
	}
	timer.begin();
	run.draw(t, settings(), w, h);
	timer.end();
}

const intervals: number[] = [];
let lastFrame = 0;

function updateHud(stamp: number) {
	if (lastFrame) intervals.push(stamp - lastFrame);
	lastFrame = stamp;
	if (intervals.length > 90) intervals.shift();
	if (!playing || intervals.length < 10) return;
	const sorted = [...intervals].sort((a, b) => a - b);
	const mean = sorted.reduce((a, b) => a + b, 0) / sorted.length;
	const worst = sorted[Math.floor(sorted.length * 0.95)];
	const { w, h } = size();
	hud.textContent = [
		`${(1000 / mean).toFixed(0)} fps · worst 5% ${worst.toFixed(1)} ms`,
		timer.ms === null ? "GPU time n/a" : `GPU ${timer.ms.toFixed(1)} ms`,
		`${w}×${h} · ${run?.hud() ?? ""}`,
		`read the song in ${(analyzeMs / 1000).toFixed(1)} s`,
	].join("\n");
}

function loop(stamp: number) {
	requestAnimationFrame(loop);
	if (playing && now() >= songLength()) pause();
	const t = now();
	if (playing || dirty) {
		try {
			drawAt(t);
		} catch (e) {
			pause();
			showError(e);
		}
		dirty = false;
	}
	playhead.style.left = `${(t / (songLength() || 1)) * 100}%`;
	$("clock").textContent = `${t.toFixed(1)} / ${songLength().toFixed(1)} s`;
	updateHud(stamp);
}

function drawStrip() {
	const ctx = strip.getContext("2d");
	const view = built ? run?.strip() : null;
	if (!ctx || !view) return;
	const w = (strip.width = strip.clientWidth);
	const h = (strip.height = strip.clientHeight);
	ctx.clearRect(0, 0, w, h);
	for (const [values, color] of view.lanes) {
		ctx.fillStyle = color;
		for (let x = 0; x < w; x++) {
			const a = Math.floor((x / w) * view.frames);
			const b = Math.max(a + 1, Math.floor(((x + 1) / w) * view.frames));
			let peak = 0;
			for (let i = a; i < b; i++) peak = Math.max(peak, values[i]);
			ctx.globalAlpha = 0.55;
			const bar = peak * h;
			ctx.fillRect(x, h - bar, 1, bar);
		}
	}
	ctx.globalAlpha = 1;
	ctx.fillStyle = "#fff";
	for (const cut of view.cuts) {
		ctx.fillRect((cut / view.frames) * w, 0, 1, h);
	}
}

// ---- Panel
function renderPalettes() {
	const palette = $<HTMLSelectElement>("palette");
	palette.replaceChildren();
	for (const name of Object.keys(visual.palettes)) {
		palette.add(new Option(name, name));
	}
	palette.value = lookOf(visual).palette;
}

function renderKnobs() {
	const el = $("knobs");
	el.replaceChildren();
	const { values } = lookOf(visual);
	for (const [group, name] of visual.groups) {
		const title = document.createElement("h4");
		title.textContent = name;
		el.append(title);
		for (const knob of visual.knobs.filter((k) => k.group === group)) {
			const wrap = document.createElement("div");
			wrap.className = "ctl";
			const label = document.createElement("label");
			const value = document.createElement("span");
			value.textContent = String(values[knob.key]);
			label.append(knob.label, value);
			const input = document.createElement("input");
			input.type = "range";
			input.min = String(knob.min);
			input.max = String(knob.max);
			input.step = String(knob.step);
			input.value = String(values[knob.key]);
			input.oninput = () => {
				values[knob.key] = Number(input.value);
				value.textContent = input.value;
				save();
				if (visual.tableKnobs.includes(knob.key)) rebuild();
				dirty = true;
			};
			wrap.append(label, input);
			el.append(wrap);
		}
	}
}

function resetKnobs() {
	lookOf(visual).values = defaults(visual);
	save();
	renderKnobs();
	rebuild();
}

function setSeed(seed: number) {
	state.seed = Math.max(0, Math.floor(seed));
	$<HTMLInputElement>("seed").value = String(state.seed);
	save();
	rebuild();
}

function initPanel() {
	const picker = $<HTMLSelectElement>("visual");
	for (const v of VISUALS) picker.add(new Option(v.name, v.id));
	picker.value = visual.id;
	picker.onchange = () => {
		visual = VISUALS.find((v) => v.id === picker.value) ?? VISUALS[0];
		state.visual = visual.id;
		save();
		renderPalettes();
		renderKnobs();
		startVisual();
	};
	const palette = $<HTMLSelectElement>("palette");
	palette.onchange = () => {
		lookOf(visual).palette = palette.value;
		save();
		dirty = true;
	};
	const ratio = $<HTMLSelectElement>("ratio");
	for (const name of Object.keys(RATIOS)) ratio.add(new Option(name, name));
	ratio.value = state.ratio;
	ratio.onchange = () => {
		state.ratio = ratio.value;
		save();
		dirty = true;
	};
	const short = $<HTMLSelectElement>("short");
	short.value = String(state.short);
	short.onchange = () => {
		state.short = Number(short.value);
		save();
		dirty = true;
	};
	const seedEl = $<HTMLInputElement>("seed");
	seedEl.value = String(state.seed);
	seedEl.onchange = () => setSeed(Number(seedEl.value));
	$("reroll").onclick = () => setSeed(Math.floor(Math.random() * 1e6));
	$("play").onclick = () => (playing ? pause() : void play());
	$("reset").onclick = resetKnobs;
	$("copy").onclick = () =>
		void navigator.clipboard.writeText(JSON.stringify(state));
	const file = $<HTMLInputElement>("file");
	$("add").onclick = () => file.click();
	file.onchange = () => {
		if (file.files) void addFiles(file.files);
		file.value = "";
	};
	strip.onclick = (e) => {
		const box = strip.getBoundingClientRect();
		seek(((e.clientX - box.left) / box.width) * songLength());
	};
	window.addEventListener("resize", drawStrip);
	window.addEventListener("dragover", (e) => e.preventDefault());
	window.addEventListener("drop", (e) => {
		e.preventDefault();
		if (e.dataTransfer?.files.length) void addFiles(e.dataTransfer.files);
	});
	window.addEventListener("keydown", (e) => {
		if ((e.target as HTMLElement).matches("input, select")) return;
		if (e.key === " ") {
			e.preventDefault();
			if (playing) pause();
			else void play();
		} else if (e.key === "ArrowLeft") seek(now() - 5);
		else if (e.key === "ArrowRight") seek(now() + 5);
	});
}

initPanel();
renderPalettes();
renderKnobs();
startVisual();
requestAnimationFrame(loop);

// Debug hook for a headless smoke run.
(window as unknown as { __musiclab: unknown }).__musiclab = {
	addBuffer(buffer: AudioBuffer, name: string, drives = true) {
		lanes.push({ id: crypto.randomUUID(), name, buffer, drives });
		return reanalyze();
	},
	drawAt,
	run: () => run,
	rebuild,
	gl,
	state,
};
