/** What a saved slideshow or single edit looks like at a glance: its first few
 * sources as thumbnails, and a single edit's effects by name. */

import { getDefinition } from "../effects/hydrate";
import { probeSlideVideo } from "../slideshow/video-sampler";
import {
	getAllSessions,
	getSequenceMediaByIds,
	storedMediaToFile,
	type SessionMode,
	type StoredSession,
} from "./sequence-media-store";

export const PREVIEW_FRAMES = 5;
const THUMB_SIZE = 128;

export interface ProjectPreview {
	sourceIds: string[];
	/** A single edit's shown effects, in chain order. */
	effects: string[];
	hasSong: boolean;
}

export function previewOf(
	session: Pick<StoredSession, "mode" | "sourceIds" | "state" | "trackId">,
): ProjectPreview {
	const frames = session.mode === "single" ? 1 : PREVIEW_FRAMES;
	return {
		sourceIds: session.sourceIds.slice(0, frames),
		effects: session.mode === "single" ? effectNames(session.state) : [],
		hasSong: !!session.trackId,
	};
}

function effectNames(state: unknown): string[] {
	const effects = (state as { effects?: unknown } | null)?.effects;
	if (!Array.isArray(effects)) return [];
	return effects.flatMap((e) => {
		if (!e || typeof e !== "object" || e.enabled === false) return [];
		const name = getDefinition(String(e.defId))?.name;
		return name ? [name] : [];
	});
}

export async function readProjectPreviews(
	mode: SessionMode,
): Promise<Map<string, ProjectPreview>> {
	const sessions = await getAllSessions();
	return new Map(
		sessions.filter((s) => s.mode === mode).map((s) => [s.key, previewOf(s)]),
	);
}

/** Per source id, for the life of the page: media under an id never changes. */
const thumbs = new Map<string, Promise<string | null>>();

export function sourceThumb(id: string): Promise<string | null> {
	let thumb = thumbs.get(id);
	if (!thumb) {
		thumb = queued(() => makeThumb(id)).catch(() => null);
		thumbs.set(id, thumb);
	}
	return thumb;
}

async function makeThumb(id: string): Promise<string | null> {
	const [entry] = await getSequenceMediaByIds([id]);
	if (!entry) return null;
	const file = storedMediaToFile(entry);
	const blob = file.type.startsWith("video/")
		? ((await probeSlideVideo(file, THUMB_SIZE))?.thumb ?? null)
		: await imageThumb(file);
	return blob ? URL.createObjectURL(blob) : null;
}

async function imageThumb(file: File): Promise<Blob | null> {
	const image = await decodeImage(file);
	if (!image) return null;
	try {
		const scale = Math.min(1, THUMB_SIZE / Math.min(image.width, image.height));
		const w = Math.max(1, Math.round(image.width * scale));
		const h = Math.max(1, Math.round(image.height * scale));
		const canvas = new OffscreenCanvas(w, h);
		canvas.getContext("2d")!.drawImage(image.source, 0, 0, w, h);
		return await canvas.convertToBlob({ type: "image/jpeg", quality: 0.8 });
	} finally {
		image.close();
	}
}

interface DecodedImage {
	source: CanvasImageSource;
	width: number;
	height: number;
	close: () => void;
}

/** createImageBitmap first; an <img> for what it refuses, SVG among them. */
async function decodeImage(file: File): Promise<DecodedImage | null> {
	try {
		const bitmap = await createImageBitmap(file);
		return {
			source: bitmap,
			width: bitmap.width,
			height: bitmap.height,
			close: () => bitmap.close(),
		};
	} catch {}
	const url = URL.createObjectURL(file);
	const img = new Image();
	img.src = url;
	try {
		await img.decode();
	} catch {
		URL.revokeObjectURL(url);
		return null;
	}
	if (!img.naturalWidth || !img.naturalHeight) {
		URL.revokeObjectURL(url);
		return null;
	}
	return {
		source: img,
		width: img.naturalWidth,
		height: img.naturalHeight,
		close: () => URL.revokeObjectURL(url),
	};
}

/** Two at a time, so a list of photo-heavy slideshows doesn't decode all at once. */
const MAX_RUNNING = 2;
let running = 0;
const waiting: (() => void)[] = [];

async function queued<T>(task: () => Promise<T>): Promise<T> {
	// A finished task hands its slot straight to the next, so none slips in between.
	if (running >= MAX_RUNNING) {
		await new Promise<void>((resolve) => waiting.push(resolve));
	} else running++;
	try {
		return await task();
	} finally {
		const next = waiting.shift();
		if (next) next();
		else running--;
	}
}
