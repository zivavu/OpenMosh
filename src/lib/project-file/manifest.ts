/** The manifest inside a project file: its shape, how it's validated, and how the
 * ids it carries are rewritten when an import lands on different ones. */

import type { LegacySegmentEntry, SeqEntry } from "../editor/seq-entry";
import type { MediaClip, MediaLane } from "../media/types";
import type { AudioClip, AudioLane } from "../mix/types";
import { records } from "../records";
import type { SourceEdit } from "../media/source-edit";
import { trackIdOf, trackSourceId } from "../mix/types";

export const PROJECT_FORMAT = "openmosh-project";
/** Bumped when the manifest's shape changes; separate from SEQ_ENTRY_VERSION. */
export const PROJECT_VERSION = 1;

export interface ProjectPoolEntry {
	/** The source id the timeline references. */
	id: string;
	name: string;
	type: string;
	lastModified: number;
	/** Where the bytes live in the zip. */
	path: string;
}

export interface ProjectSongEntry {
	trackId: string;
	name: string;
	fileName: string;
	/** MIME type; a slice of the zip carries none. */
	type: string;
	path: string;
}

export interface ProjectFontEntry {
	id: string;
	family: string;
	/** Files from before fonts were always embedded may carry a link instead. */
	url?: string;
	path?: string;
}

export interface ProjectManifest {
	format: string;
	version: number;
	app: string;
	savedAt: number;
	name: string;
	entry: SeqEntry;
	pool: ProjectPoolEntry[];
	songs: ProjectSongEntry[];
	fonts: ProjectFontEntry[];
}

/** Whether a font link a project file names may be fetched on import: Google Fonts
 * only, so opening a file someone sent can't make the browser call any other site. */
export function isFetchableFontUrl(url: string): boolean {
	try {
		const { protocol, hostname } = new URL(url);
		return (
			protocol === "https:" &&
			(hostname === "fonts.googleapis.com" || hostname === "fonts.google.com")
		);
	} catch {
		return false;
	}
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** A zip entry name that can't climb out of the archive. */
function safePath(value: unknown, prefix: string): string {
	if (typeof value !== "string" || value.length === 0) {
		throw new Error("That project file has a file with no name");
	}
	const path = value.replace(/\\/g, "/");
	if (
		path.startsWith("/") ||
		/^[a-zA-Z]:/.test(path) ||
		path.split("/").some((part) => part === ".." || part === ".")
	) {
		throw new Error("That project file points outside itself");
	}
	if (!path.startsWith(prefix)) {
		throw new Error("That project file has a file in the wrong place");
	}
	return path;
}

function parsePool(raw: unknown): ProjectPoolEntry[] {
	if (!Array.isArray(raw)) return [];
	const out: ProjectPoolEntry[] = [];
	for (const item of raw) {
		if (!isRecord(item) || typeof item.id !== "string") continue;
		out.push({
			id: item.id,
			name: typeof item.name === "string" ? item.name : "file",
			type: typeof item.type === "string" ? item.type : "",
			lastModified:
				typeof item.lastModified === "number" ? item.lastModified : 0,
			path: safePath(item.path, "media/"),
		});
	}
	return out;
}

function parseSongs(raw: unknown): ProjectSongEntry[] {
	if (!Array.isArray(raw)) return [];
	const out: ProjectSongEntry[] = [];
	for (const item of raw) {
		if (!isRecord(item) || typeof item.trackId !== "string") continue;
		const name = typeof item.name === "string" ? item.name : "song";
		out.push({
			trackId: item.trackId,
			name,
			fileName: typeof item.fileName === "string" ? item.fileName : name,
			type: typeof item.type === "string" ? item.type : "",
			path: safePath(item.path, "songs/"),
		});
	}
	return out;
}

function parseFonts(raw: unknown): ProjectFontEntry[] {
	if (!Array.isArray(raw)) return [];
	const out: ProjectFontEntry[] = [];
	for (const item of raw) {
		if (!isRecord(item) || typeof item.id !== "string") continue;
		const url = typeof item.url === "string" ? item.url : undefined;
		const path =
			item.path === undefined ? undefined : safePath(item.path, "fonts/");
		if (!url && !path) continue;
		out.push({
			id: item.id,
			family: typeof item.family === "string" ? item.family : "",
			...(url ? { url } : {}),
			...(path ? { path } : {}),
		});
	}
	return out;
}

/** Read a `project.json`, rejecting anything that isn't one of ours. */
export function parseManifest(raw: unknown): ProjectManifest {
	if (!isRecord(raw) || raw.format !== PROJECT_FORMAT) {
		throw new Error("That isn't an OpenMosh project file");
	}
	const version = typeof raw.version === "number" ? raw.version : 0;
	if (version > PROJECT_VERSION) {
		throw new Error("Made by a newer OpenMosh; update and try again");
	}
	if (!isRecord(raw.entry)) {
		throw new Error("That project file has no timeline");
	}
	return {
		format: PROJECT_FORMAT,
		version,
		app: typeof raw.app === "string" ? raw.app : "",
		savedAt: typeof raw.savedAt === "number" ? raw.savedAt : 0,
		name: typeof raw.name === "string" ? raw.name : "",
		entry: raw.entry as SeqEntry,
		pool: parsePool(raw.pool),
		songs: parseSongs(raw.songs),
		fonts: parseFonts(raw.fonts),
	};
}

/** Rewrite the ids a timeline carries onto the ids it landed on: the song, every
 * `track:` source on an audio lane, and every pool source. */
export function remapProject(
	entry: SeqEntry,
	trackIds: Map<string, string>,
	sourceIds: Map<string, string>,
): SeqEntry {
	const source = (id: string | null | undefined): string | null | undefined => {
		if (!id) return id;
		const track = trackIdOf(id);
		if (track !== null) {
			const next = trackIds.get(track);
			return next ? trackSourceId(next) : id;
		}
		return sourceIds.get(id) ?? id;
	};

	const next: SeqEntry = { ...entry };
	if (entry.song && trackIds.has(entry.song))
		next.song = trackIds.get(entry.song);
	if (typeof entry.bpmSource === "string")
		next.bpmSource = source(entry.bpmSource) ?? undefined;

	// The editor's normalisers repair anything else; this only has to not trip on it.
	if (isRecord(entry.media)) {
		next.media = {
			...entry.media,
			lanes: records<MediaLane>(entry.media.lanes).map((lane) => ({
				...lane,
				sourceId: source(lane.sourceId) ?? null,
				clips: records<MediaClip>(lane.clips).map((clip) => ({
					...clip,
					sourceId: source(clip.sourceId) ?? undefined,
				})),
			})) as MediaLane[],
			audioLanes: records<AudioLane>(entry.media.audioLanes).map((lane) => ({
				...lane,
				clips: records<AudioClip>(lane.clips).map((clip) => ({
					...clip,
					sourceId: source(clip.sourceId) ?? null,
				})),
			})) as AudioLane[],
		};
	}

	// Saved before layers took the media over; folded into lanes when opened.
	if (Array.isArray(entry.segments)) {
		next.segments = records<LegacySegmentEntry>(entry.segments).map((seg) => ({
			...seg,
			sourceId: source(seg.sourceId) ?? undefined,
		}));
	}

	if (isRecord(entry.sourceEdits)) {
		const edits: Record<string, SourceEdit> = {};
		for (const [id, edit] of Object.entries(entry.sourceEdits)) {
			edits[sourceIds.get(id) ?? id] = edit;
		}
		next.sourceEdits = edits;
	}

	return next;
}
