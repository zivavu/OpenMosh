/** A whole-browser backup: every project, song, media file, font, preset and setting
 * in one stored zip, and loading one back into another browser. Proxies stay out;
 * each video rebuilds its own. */

import {
	getAllTracks,
	putTracks,
	type StoredTrack,
} from "../audio/track-library";
import { APP_VERSION } from "../build-info";
import {
	getAllMediaPools,
	getAllSequenceMedia,
	getAllSessions,
	getAllTimelines,
	putBackupRecords,
	type StoredMediaPool,
	type StoredSequenceMedia,
	type StoredSession,
	type StoredTimeline,
} from "../editor/sequence-media-store";
import { records } from "../records";
import { readRaw, writeRaw } from "../storage";
import {
	addCustomFontData,
	customFonts,
	getCustomFontData,
	type CustomFont,
} from "../text-overlay/custom-fonts.svelte";
import { readZip, writeZip, type ZipEntryInput } from "../project-file/zip";

export const BACKUP_FORMAT = "openmosh-backup";
/** Bumped when the manifest's shape changes. */
export const BACKUP_VERSION = 1;
export const BACKUP_EXTENSION = ".openmosh-backup";

type WithPath<T> = Omit<T, "blob" | "data"> & { path: string };

export interface BackupManifest {
	format: string;
	version: number;
	app: string;
	savedAt: number;
	/** Raw localStorage strings, by key. */
	localStorage: Record<string, string>;
	media: WithPath<StoredSequenceMedia>[];
	tracks: (WithPath<StoredTrack> & { type: string })[];
	fonts: WithPath<CustomFont>[];
	pools: StoredMediaPool[];
	sessions: StoredSession[];
	timelines: StoredTimeline[];
}

/** Mirrors the upload screen rebuilds, and the edit a reload reopens: this browser's own. */
const LOCAL_ONLY_KEY =
	/^openmosh-(saved-sequences$|saved-sessions:|last-opened$)/;

function isBackedUpKey(key: string): boolean {
	return key.startsWith("openmosh") && !LOCAL_ONLY_KEY.test(key);
}

function localStorageEntries(): Record<string, string> {
	const out: Record<string, string> = {};
	try {
		for (let i = 0; i < localStorage.length; i++) {
			const key = localStorage.key(i);
			if (!key || !isBackedUpKey(key)) continue;
			const value = readRaw(key);
			if (value !== null) out[key] = value;
		}
	} catch {
		// Blocked localStorage; the IndexedDB half still stands.
	}
	return out;
}

/** A dated download name. */
export function backupFileName(now = new Date()): string {
	const pad = (n: number) => String(n).padStart(2, "0");
	const day = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
	return `openmosh-${day}${BACKUP_EXTENSION}`;
}

export async function buildBackup(): Promise<Blob> {
	const [media, tracks, pools, sessions, timelines] = await Promise.all([
		getAllSequenceMedia(),
		getAllTracks(),
		getAllMediaPools(),
		getAllSessions(),
		getAllTimelines(),
	]);
	const parts: ZipEntryInput[] = [];

	const mediaEntries = media.map(({ blob, ...meta }, i) => {
		const path = `media/${i}`;
		parts.push({ name: path, blob });
		return { ...meta, type: meta.type || blob.type, path };
	});

	const trackEntries = tracks.map(({ blob, ...meta }, i) => {
		const path = `songs/${i}`;
		parts.push({ name: path, blob });
		return { ...meta, type: blob.type, path };
	});

	const fontEntries: WithPath<CustomFont>[] = [];
	for (const font of customFonts()) {
		const data = await getCustomFontData(font.id);
		if (!data) continue;
		const path = `fonts/${fontEntries.length}`;
		parts.push({ name: path, blob: new Blob([data]) });
		fontEntries.push({ ...font, path });
	}

	const manifest: BackupManifest = {
		format: BACKUP_FORMAT,
		version: BACKUP_VERSION,
		app: APP_VERSION,
		savedAt: Date.now(),
		localStorage: localStorageEntries(),
		media: mediaEntries,
		tracks: trackEntries,
		fonts: fontEntries,
		pools,
		sessions,
		timelines,
	};

	return writeZip([
		{
			name: "backup.json",
			blob: new Blob([JSON.stringify(manifest)], { type: "application/json" }),
		},
		...parts,
	]);
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** What a list's records are keyed on; presets have no id, only a name. */
function recordKey(list: unknown[]): "id" | "name" | null {
	for (const field of ["id", "name"] as const) {
		if (
			list.every(
				(item) => isPlainObject(item) && typeof item[field] === "string",
			)
		)
			return field;
	}
	return null;
}

/** A backed-up localStorage value laid over this browser's. Maps keyed by song or
 * project merge, lists of records merge by id (presets by name), anything else is replaced;
 * the backup wins wherever both have an entry. */
export function mergeStoredValue(
	current: string | null,
	incoming: string,
): string {
	if (current === null) return incoming;
	let here: unknown;
	let there: unknown;
	try {
		here = JSON.parse(current);
		there = JSON.parse(incoming);
	} catch {
		return incoming;
	}
	if (isPlainObject(here) && isPlainObject(there)) {
		return JSON.stringify({ ...here, ...there });
	}
	if (Array.isArray(here) && Array.isArray(there)) {
		// Judged over both, so an empty list on either side still merges.
		const field = recordKey([...here, ...there]);
		if (field) {
			const key = (item: Record<string, unknown>) => item[field];
			const merged = new Map(here.map((item) => [key(item), item]));
			for (const item of there) merged.set(key(item), item);
			return JSON.stringify([...merged.values()]);
		}
	}
	return incoming;
}

function keyed<T>(raw: unknown, field: "id" | "key"): Partial<T>[] {
	return records<T>(raw).filter(
		(item) => typeof (item as Record<string, unknown>)[field] === "string",
	);
}

export interface RestoreSummary {
	media: number;
	songs: number;
	fonts: number;
	/** Saved timelines and sessions: the edits themselves. */
	edits: number;
}

/** Merge a backup into this browser's storage. Records with the same key as one here
 * replace it. Throws with a readable message on a file that isn't a backup. */
export async function restoreBackup(file: Blob): Promise<RestoreSummary> {
	let entries;
	try {
		entries = await readZip(file);
	} catch {
		throw new Error("That isn't an OpenMosh backup");
	}
	const byPath = new Map(entries.map((e) => [e.name, e.blob]));
	const manifestBlob = byPath.get("backup.json");
	if (!manifestBlob) {
		throw new Error(
			byPath.has("project.json")
				? "That's a project file. Open it from the start screen"
				: "That isn't an OpenMosh backup",
		);
	}

	let raw: unknown;
	try {
		raw = JSON.parse(await manifestBlob.text());
	} catch {
		throw new Error("That backup is damaged");
	}
	if (!isPlainObject(raw) || raw.format !== BACKUP_FORMAT) {
		throw new Error("That isn't an OpenMosh backup");
	}
	if (typeof raw.version !== "number" || raw.version > BACKUP_VERSION) {
		throw new Error(
			"That backup is from a newer OpenMosh. Reload the page and try again",
		);
	}

	// Bytes first, records after: a write refused partway leaves media nothing points
	// at, which the next prune clears, rather than edits whose media is missing.
	const media: StoredSequenceMedia[] = [];
	for (const item of keyed<WithPath<StoredSequenceMedia>>(raw.media, "id")) {
		const blob = typeof item.path === "string" && byPath.get(item.path);
		if (!blob) continue;
		const { path: _path, ...meta } = item;
		const type = typeof meta.type === "string" ? meta.type : "";
		media.push({
			...(meta as Omit<StoredSequenceMedia, "blob">),
			type,
			blob: new Blob([blob], { type }),
		});
	}
	await putBackupRecords("media", media);

	const tracks: StoredTrack[] = [];
	for (const item of keyed<WithPath<StoredTrack> & { type: string }>(
		raw.tracks,
		"id",
	)) {
		const blob = typeof item.path === "string" && byPath.get(item.path);
		if (!blob) continue;
		const { path: _path, type, ...meta } = item;
		tracks.push({
			...(meta as Omit<StoredTrack, "blob">),
			blob: new Blob([blob], { type: typeof type === "string" ? type : "" }),
		});
	}
	if (tracks.length > 0) await putTracks(tracks);

	let fonts = 0;
	const families = new Set(customFonts().map((f) => f.family));
	for (const item of keyed<WithPath<CustomFont>>(raw.fonts, "id")) {
		const blob = typeof item.path === "string" && byPath.get(item.path);
		if (!blob || typeof item.name !== "string") continue;
		if (typeof item.family === "string" && families.has(item.family)) continue;
		try {
			await addCustomFontData(
				item.name,
				item.sourceUrl ?? item.name,
				await blob.arrayBuffer(),
			);
			fonts++;
		} catch {
			// A face this browser can't read; text set in it falls back.
		}
	}

	const pools = keyed<StoredMediaPool>(raw.pools, "key").filter((p) =>
		Array.isArray(p.sourceIds),
	);
	const sessions = keyed<StoredSession>(raw.sessions, "key").filter((s) =>
		Array.isArray(s.sourceIds),
	);
	const timelines = keyed<StoredTimeline>(raw.timelines, "key");
	await putBackupRecords("pools", pools);
	await putBackupRecords("sessions", sessions);
	await putBackupRecords("timelines", timelines);

	if (isPlainObject(raw.localStorage)) {
		for (const [key, value] of Object.entries(raw.localStorage)) {
			if (typeof value !== "string" || !isBackedUpKey(key)) continue;
			writeRaw(key, mergeStoredValue(readRaw(key), value));
		}
	}

	return {
		media: media.length,
		songs: tracks.length,
		fonts,
		edits: sessions.length + timelines.length,
	};
}
