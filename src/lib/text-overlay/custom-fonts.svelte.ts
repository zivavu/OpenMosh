/** User-added fonts, pasted in as a Google Fonts link (or a direct font-file URL)
 * or uploaded off disk. The bytes live in IndexedDB, not the link. */
import { showToast } from "../components/ui/toast.svelte";
import { generateId } from "../effects/types";
import { simpleStore } from "../idb";
import {
	bumpFontsVersion,
	registerFamily,
	setFontsPending,
	unregisterFamily,
} from "./font-registry";
import { packFontSlices, unpackFontSlices, type FontSlice } from "./font-pack";
import { parseFontFaces, pickFaces, requestedFamily } from "./font-faces";
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
	/** The woff2/ttf/otf bytes, or several packed by font-pack.ts. */
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

/** The stored bytes for a font, for saving it into a project file. */
export async function getCustomFontData(
	id: string,
): Promise<ArrayBuffer | null> {
	return (await db.get<StoredFont>(id))?.data ?? null;
}

/** Every font the user has added, newest last. Reactive. */
export function customFonts(): CustomFont[] {
	return fonts;
}

/** The face's name as CSS asks for it: the family without its quotes. The display
 * name can hold an apostrophe the family had to drop. */
function faceName(font: Pick<CustomFont, "family">): string {
	return font.family.replace(/^'|'$/g, "");
}

/** The font's files, one per script subset when it came from Google Fonts. */
function fontSlices(data: ArrayBuffer): FontSlice[] {
	return unpackFontSlices(data) ?? [{ data, unicodeRange: "" }];
}

/** Register a stored face with the document so 2D-canvas drawing can use it. */
function registerFont(font: StoredFont): void {
	const loads = fontSlices(font.data).map((slice) =>
		// A copy: FontFace takes ownership of the buffer, and the same record may come
		// back from a later getAll().
		new FontFace(
			faceName(font),
			slice.data.slice(0),
			slice.unicodeRange ? { unicodeRange: slice.unicodeRange } : {},
		).load(),
	);
	const promise = Promise.allSettled(loads).then((results) => {
		const loaded = results.filter((r) => r.status === "fulfilled");
		if (loaded.length === 0) {
			unregisterFamily(font.family);
			return;
		}
		for (const r of loaded) document.fonts.add(r.value);
		bumpFontsVersion();
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

/** Title-case a file stem so `press-start-2p.woff2` reads as a face name. */
function nameFromFileUrl(url: string): string {
	const stem = decodedName(url.split(/[?#]/)[0].split("/").pop() ?? "")
		.replace(FONT_FILE_RE, "")
		.replace(/[_-]+/g, " ")
		.trim();
	if (!stem) return "Custom Font";
	return stem.replace(/\b\w/g, (c) => c.toUpperCase());
}

/** A file name like `Brand 100%.otf` isn't URL-encoded, and decoding it would throw. */
function decodedName(name: string): string {
	try {
		return decodeURIComponent(name);
	} catch {
		return name;
	}
}

/** A fetch that says why it failed: a site blocking other pages reads as a bare
 * "Failed to fetch" otherwise. */
async function fetchOrExplain(url: string): Promise<Response> {
	try {
		return await fetch(url);
	} catch {
		throw new Error(
			"That site won't let other pages load its fonts. Download the font file and add it from your computer instead.",
		);
	}
}

async function fetchBytes(url: string): Promise<ArrayBuffer> {
	const res = await fetchOrExplain(url);
	if (!res.ok) throw new Error(`Couldn't fetch the font file (${res.status}).`);
	return res.arrayBuffer();
}

/** Fetch, register and save the font the URL points at. Accepts a Google Fonts
 * link (share, specimen or css2) or a direct woff2/ttf/otf URL. */
export async function addCustomFont(input: string): Promise<CustomFont> {
	const trimmed = input.trim();
	if (!trimmed) throw new Error("Paste a font link first.");

	const cssUrl = toStylesheetUrl(trimmed);
	if (cssUrl) {
		const res = await fetchOrExplain(cssUrl);
		if (!res.ok) {
			throw new Error(`Google Fonts didn't return that font (${res.status}).`);
		}
		const faces = pickFaces(
			parseFontFaces(await res.text()),
			requestedFamily(cssUrl),
		);
		if (faces.length === 0) throw new Error("No font face in that stylesheet.");
		const slices = await Promise.all(
			faces.map(async (f) => ({
				data: await fetchBytes(f.url),
				unicodeRange: f.unicodeRange,
			})),
		);
		const data = slices.length > 1 ? packFontSlices(slices) : slices[0].data;
		return addCustomFontData(faces[0].name, trimmed, data);
	}
	if (FONT_FILE_RE.test(trimmed)) {
		return addCustomFontData(
			nameFromFileUrl(trimmed),
			trimmed,
			await fetchBytes(trimmed),
		);
	}
	throw new Error(
		"Paste a Google Fonts link, or a direct .woff2/.ttf/.otf URL.",
	);
}

/** Add a font the user picked off disk. Same result as a pasted link, minus the
 * fetch. */
export async function addCustomFontFile(file: File): Promise<CustomFont> {
	if (!FONT_FILE_RE.test(file.name)) {
		throw new Error("Pick a .woff2, .woff, .ttf or .otf file.");
	}
	return addCustomFontData(
		nameFromFileUrl(file.name),
		file.name,
		await file.arrayBuffer(),
	);
}

/** Add a font from bytes under an explicit name, for a project file that carries
 * the face's own name. */
export async function addCustomFontData(
	name: string,
	sourceUrl: string,
	data: ArrayBuffer,
): Promise<CustomFont> {
	// Parse it before it goes anywhere: a file the browser can't read would otherwise
	// sit in the list and silently draw as the fallback face.
	try {
		await new FontFace(
			"OpenMoshProbe",
			fontSlices(data)[0].data.slice(0),
		).load();
	} catch {
		throw new Error(`${name} isn't a font this browser can read.`);
	}
	return saveFont(name, sourceUrl, data);
}

async function saveFont(
	name: string,
	sourceUrl: string,
	data: ArrayBuffer,
): Promise<CustomFont> {
	// Set in style attributes as written: anything that could end the value or the
	// declaration goes, so a name from a project file can't add CSS of its own.
	const family = `'${name.replace(/['"\\;{}<>\p{Cc}]/gu, "").trim() || "Custom Font"}'`;
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
		// Still usable this session, so say it won't outlast a reload.
		showToast(
			`Couldn't save ${name} in this browser, so it'll be gone after a reload`,
			"error",
			8000,
		);
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
	const face = faceName(font);
	const faces = [...document.fonts].filter(
		(f) => f.family.replace(/^["']|["']$/g, "") === face,
	);
	for (const face of faces) document.fonts.delete(face);
	bumpFontsVersion();
	try {
		await deleteStored(id);
	} catch {
		// Nothing to do; it's already gone from this session.
	}
}
