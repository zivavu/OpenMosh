/** User-added fonts, pasted in as a Google Fonts link (or a direct font-file URL)
 * or uploaded off disk. The bytes live in IndexedDB, not the link. */
import { generateId } from "../effects/types";
import { simpleStore } from "../idb";
import {
	bumpFontsVersion,
	registerFamily,
	setFontsPending,
	unregisterFamily,
} from "./font-registry";
import { FONT_OPTIONS } from "./fonts";

export interface CustomFont {
	id: string;
	/** Face name as it goes to FontFace, e.g. `Rubik Glitch`. */
	name: string;
	/** CSS font-family value, quoted to match the bundled options. */
	family: string;
	/** Where it came from: the pasted link, or an uploaded file's name. */
	sourceUrl: string;
	addedAt: number;
}

interface StoredFont extends CustomFont {
	/** The woff2/ttf/otf bytes. */
	data: ArrayBuffer;
}

const db = simpleStore("openmosh-fonts", "fonts");

function getAllStored(): Promise<StoredFont[]> {
	return db.getAll<StoredFont>();
}

function putStored(font: StoredFont): Promise<void> {
	return db.put(font);
}

function deleteStored(id: string): Promise<void> {
	return db.delete(id);
}

let fonts: CustomFont[] = $state([]);

/** Bytes stored per font id, for the storage manager. */
export async function getCustomFontSizes(): Promise<Map<string, number>> {
	const stored = await getAllStored();
	return new Map(stored.map((f) => [f.id, f.data.byteLength]));
}

/** Every font the user has added, newest last. Reactive. */
export function customFonts(): CustomFont[] {
	return fonts;
}

/** Register a stored face with the document so 2D-canvas drawing can use it. */
function registerFont(font: StoredFont): void {
	// A slice: FontFace takes ownership of the buffer, and the same record may come
	// back from a later getAll().
	const face = new FontFace(font.name, font.data.slice(0));
	const promise = face
		.load()
		.then((f) => {
			document.fonts.add(f);
			bumpFontsVersion();
		})
		.catch(() => {
			unregisterFamily(font.family);
		});
	registerFamily(font.family, promise);
}

let loadPromise: Promise<void> | null = null;

/** Read every saved font out of IndexedDB and register it. Called once at startup. */
export function loadCustomFonts(): Promise<void> {
	if (!loadPromise) {
		loadPromise = getAllStored()
			.then((stored) => {
				stored.sort((a, b) => a.addedAt - b.addedAt);
				for (const font of stored) registerFont(font);
				fonts = stored.map(({ data: _data, ...rest }) => rest);
			})
			.catch(() => {
				// No IndexedDB (private window, blocked storage): bundled fonts only.
			});
		setFontsPending(loadPromise);
	}
	return loadPromise;
}

const FONT_FILE_RE = /\.(woff2?|ttf|otf)(?:[?#]|$)/i;

/** Whatever the user pasted, as a Google Fonts CSS URL, or null if it isn't one. */
function toStylesheetUrl(input: string): string | null {
	let url: URL;
	try {
		url = new URL(input.trim());
	} catch {
		return null;
	}
	if (url.hostname === "fonts.googleapis.com") return url.toString();
	if (url.hostname === "fonts.google.com") {
		// Specimen page: /specimen/Rubik+Glitch
		const family = /\/specimen\/([^/?#]+)/.exec(url.pathname)?.[1];
		if (family) return `https://fonts.googleapis.com/css2?family=${family}`;
	}
	return null;
}

interface ParsedFace {
	name: string;
	url: string;
	weight: number;
	italic: boolean;
	/** Empty when the block covers everything. */
	unicodeRange: string;
}

function parseFontFaces(css: string): ParsedFace[] {
	const faces: ParsedFace[] = [];
	for (const block of css.matchAll(/@font-face\s*\{([^}]*)\}/g)) {
		const body = block[1];
		const name = /font-family:\s*(['"]?)(.+?)\1\s*;/.exec(body)?.[2]?.trim();
		const src =
			/url\(\s*['"]?(https?:\/\/[^'")\s]+\.woff2[^'")\s]*)/i.exec(body)?.[1] ??
			/url\(\s*['"]?(https?:\/\/[^'")\s]+)/i.exec(body)?.[1];
		if (!name || !src) continue;
		faces.push({
			name,
			url: src,
			weight: Number(/font-weight:\s*(\d+)/.exec(body)?.[1] ?? 400),
			italic: /font-style:\s*italic/.test(body),
			unicodeRange: /unicode-range:\s*([^;]+)/.exec(body)?.[1]?.trim() ?? "",
		});
	}
	return faces;
}

/** A Google Fonts stylesheet is one @font-face per script subset and weight. Take
 * the upright regular latin one: the overlays draw a single weight. */
function pickFace(faces: ParsedFace[]): ParsedFace | null {
	if (faces.length === 0) return null;
	const upright = faces.filter((f) => !f.italic);
	const pool = upright.length > 0 ? upright : faces;
	const latin = pool.filter(
		(f) => f.unicodeRange === "" || f.unicodeRange.includes("U+0000-00FF"),
	);
	const candidates = latin.length > 0 ? latin : pool;
	return candidates.reduce((best, f) =>
		Math.abs(f.weight - 400) < Math.abs(best.weight - 400) ? f : best,
	);
}

/** Title-case a file stem so `press-start-2p.woff2` reads as a face name. */
function nameFromFileUrl(url: string): string {
	const stem = decodeURIComponent(url.split(/[?#]/)[0].split("/").pop() ?? "")
		.replace(FONT_FILE_RE, "")
		.replace(/[_-]+/g, " ")
		.trim();
	if (!stem) return "Custom Font";
	return stem.replace(/\b\w/g, (c) => c.toUpperCase());
}

async function fetchBytes(url: string): Promise<ArrayBuffer> {
	const res = await fetch(url);
	if (!res.ok) throw new Error(`Couldn't fetch the font file (${res.status}).`);
	return res.arrayBuffer();
}

/** Fetch, register and save the font the URL points at. Accepts a Google Fonts
 * link (share, specimen or css2) or a direct woff2/ttf/otf URL. */
export async function addCustomFont(input: string): Promise<CustomFont> {
	const trimmed = input.trim();
	if (!trimmed) throw new Error("Paste a font link first.");

	let name: string;
	let fileUrl: string;

	const cssUrl = toStylesheetUrl(trimmed);
	if (cssUrl) {
		const res = await fetch(cssUrl);
		if (!res.ok) {
			throw new Error(`Google Fonts didn't return that font (${res.status}).`);
		}
		const face = pickFace(parseFontFaces(await res.text()));
		if (!face) throw new Error("No font face in that stylesheet.");
		name = face.name;
		fileUrl = face.url;
	} else if (FONT_FILE_RE.test(trimmed)) {
		name = nameFromFileUrl(trimmed);
		fileUrl = trimmed;
	} else {
		throw new Error(
			"Paste a Google Fonts link, or a direct .woff2/.ttf/.otf URL.",
		);
	}

	const data = await fetchBytes(fileUrl);
	return saveFont(name, trimmed, data);
}

/** Add a font the user picked off disk. Same result as a pasted link, minus the
 * fetch. */
export async function addCustomFontFile(file: File): Promise<CustomFont> {
	if (!FONT_FILE_RE.test(file.name)) {
		throw new Error("Pick a .woff2, .woff, .ttf or .otf file.");
	}
	const data = await file.arrayBuffer();
	// Parse it before it goes anywhere: a file the browser can't read would otherwise
	// sit in the list and silently draw as the fallback face.
	try {
		await new FontFace("OpenMoshProbe", data.slice(0)).load();
	} catch {
		throw new Error(`${file.name} isn't a font this browser can read.`);
	}
	return saveFont(nameFromFileUrl(file.name), file.name, data);
}

async function saveFont(
	name: string,
	sourceUrl: string,
	data: ArrayBuffer,
): Promise<CustomFont> {
	const family = `'${name.replace(/'/g, "")}'`;
	if (FONT_OPTIONS.some((f) => f.family === family)) {
		throw new Error(`${name} is already one of the built-in fonts.`);
	}
	if (fonts.some((f) => f.family === family)) {
		throw new Error(`${name} is already added.`);
	}

	const stored: StoredFont = {
		id: generateId(),
		name,
		family,
		sourceUrl,
		addedAt: Date.now(),
		data,
	};

	// Register before storing: a font that can't be persisted (private window) should
	// still work for this session.
	registerFont(stored);
	const { data: _data, ...meta } = stored;
	fonts = [...fonts, meta];
	try {
		await putStored(stored);
	} catch {
		// Storage refused it; it stays usable until reload.
	}
	return meta;
}

/** Forget a user font. Text still set in it falls back to the default face. */
export async function removeCustomFont(id: string): Promise<void> {
	const font = fonts.find((f) => f.id === id);
	if (!font) return;
	fonts = fonts.filter((f) => f.id !== id);
	unregisterFamily(font.family);
	// Collected first: deleting while iterating the set skips entries.
	const faces = [...document.fonts].filter((f) => f.family === font.name);
	for (const face of faces) document.fonts.delete(face);
	bumpFontsVersion();
	try {
		await deleteStored(id);
	} catch {
		// Nothing to do; it's already gone from this session.
	}
}
