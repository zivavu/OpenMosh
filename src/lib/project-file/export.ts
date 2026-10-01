/** Build a `.openmosh` project file from what's stored for a project key. */

import { getTrack } from "../audio/track-library";
import { APP_VERSION } from "../build-info";
import { readProjectNames } from "../editor/project-names";
import { isProjectKey } from "../editor/saved-sequences";
import type { SeqEntry } from "../editor/seq-entry";
import {
	getSequenceMediaByIds,
	getTimeline,
	loadMediaPool,
	storedMediaToFile,
} from "../editor/sequence-media-store";
import { trackIdOf } from "../mix/types";
import {
	customFonts,
	getCustomFontData,
} from "../text-overlay/custom-fonts.svelte";
import {
	PROJECT_FORMAT,
	PROJECT_VERSION,
	type ProjectFontEntry,
	type ProjectManifest,
	type ProjectPoolEntry,
	type ProjectSongEntry,
} from "./manifest";
import { writeZip, type ZipEntryInput } from "./zip";

export interface ProjectFileResult {
	blob: Blob;
	/** The download name, `.openmosh`. */
	name: string;
	/** Pool files whose bytes were gone from storage and so weren't saved. */
	missing: number;
}

function extOf(name: string, type: string): string {
	const dot = name.lastIndexOf(".");
	if (dot > 0 && dot < name.length - 1) {
		const ext = name.slice(dot + 1).toLowerCase();
		if (/^[a-z0-9]{1,8}$/.test(ext)) return ext;
	}
	if (type.startsWith("video/")) return "mp4";
	if (type.startsWith("image/")) return "png";
	if (type.startsWith("audio/")) return "wav";
	return "bin";
}

/** A download name safe on every platform, keeping letters and digits. */
export function projectFileName(name: string): string {
	const base = name
		.trim()
		.replace(/[^\p{L}\p{N}\-_. ]+/gu, "")
		.replace(/\s+/g, "-")
		.replace(/^-+|-+$/g, "");
	return `${base || "openmosh-project"}.openmosh`;
}

function isUrl(value: string): boolean {
	return /^https?:\/\//i.test(value.trim());
}

/** Every library song the project plays: its main song and any on an audio lane. */
function songIdsOf(entry: SeqEntry): string[] {
	const ids = new Set<string>();
	if (entry.song) ids.add(entry.song);
	for (const lane of entry.media?.audioLanes ?? []) {
		for (const clip of lane.clips) {
			const track = clip.sourceId ? trackIdOf(clip.sourceId) : null;
			if (track) ids.add(track);
		}
	}
	return [...ids];
}

/** The custom fonts a text lane's face or font cycle actually names. */
function fontFamiliesOf(entry: SeqEntry): Set<string> {
	const families = new Set<string>();
	for (const lane of entry.text?.lanes ?? []) {
		if (lane.style?.fontFamily) families.add(lane.style.fontFamily);
		for (const family of lane.style?.fontCycle?.fonts ?? []) {
			families.add(family);
		}
	}
	return families;
}

/** What the open editor has on screen, so the file doesn't wait on autosaves. */
export interface LiveProject {
	entry: SeqEntry;
	media: { id: string; file: File }[];
}

/** The pool, in order, and how many stored ids had lost their bytes. */
async function poolMedia(
	projectKey: string,
	live?: LiveProject,
): Promise<{ media: { id: string; file: File }[]; missing: number }> {
	if (live) return { media: live.media, missing: 0 };
	const ids = (await loadMediaPool(projectKey)) ?? [];
	const stored = await getSequenceMediaByIds(ids);
	return {
		media: stored.map((item) => ({
			id: item.id,
			file: storedMediaToFile(item),
		})),
		missing: ids.length - stored.length,
	};
}

/** Build the file. Without `live` the stored timeline is used, which may be an
 * older format the importer still reads. */
export async function buildProjectFile(
	projectKey: string,
	live?: LiveProject,
): Promise<ProjectFileResult> {
	let entry =
		live?.entry ??
		((await getTimeline(`seq:${projectKey}`)) as SeqEntry | null);
	if (!entry) throw new Error("This project has nothing saved yet");
	// A project keyed by its song predates the song field; the import gives it a key
	// of its own, so the song has to be named.
	if (!isProjectKey(projectKey) && !entry.song)
		entry = { ...entry, song: projectKey };

	const { media, missing } = await poolMedia(projectKey, live);
	const pool: ProjectPoolEntry[] = [];
	const mediaParts: ZipEntryInput[] = [];
	media.forEach(({ id, file }, i) => {
		const path = `media/${i}.${extOf(file.name, file.type)}`;
		pool.push({
			id,
			name: file.name,
			type: file.type,
			lastModified: file.lastModified,
			path,
		});
		mediaParts.push({ name: path, blob: file });
	});

	const songs: ProjectSongEntry[] = [];
	const songParts: ZipEntryInput[] = [];
	for (const trackId of songIdsOf(entry)) {
		const track = await getTrack(trackId).catch(() => null);
		if (!track) continue;
		const fileName = track.fileName ?? track.name;
		const path = `songs/${songs.length}.${extOf(fileName, track.blob.type)}`;
		songs.push({
			trackId,
			name: track.name,
			fileName,
			type: track.blob.type,
			path,
		});
		songParts.push({ name: path, blob: track.blob });
	}

	const families = fontFamiliesOf(entry);
	const fonts: ProjectFontEntry[] = [];
	const fontParts: ZipEntryInput[] = [];
	for (const font of customFonts()) {
		if (!families.has(font.family)) continue;
		if (isUrl(font.sourceUrl)) {
			fonts.push({ id: font.id, family: font.family, url: font.sourceUrl });
			continue;
		}
		const data = await getCustomFontData(font.id);
		if (!data) continue;
		const path = `fonts/${font.id}.woff2`;
		fonts.push({ id: font.id, family: font.family, path });
		fontParts.push({ name: path, blob: new Blob([data]) });
	}

	const names = readProjectNames();
	let name: string | undefined = names[projectKey];
	if (!name) {
		if (entry.song) {
			const track = await getTrack(entry.song).catch(() => null);
			name = track?.name;
		}
	}
	name = name || "Untitled project";

	const manifest: ProjectManifest = {
		format: PROJECT_FORMAT,
		version: PROJECT_VERSION,
		app: APP_VERSION,
		savedAt: Date.now(),
		name,
		entry,
		pool,
		songs,
		fonts,
	};

	const blob = await writeZip([
		{
			name: "project.json",
			blob: new Blob([JSON.stringify(manifest)], {
				type: "application/json",
			}),
		},
		...mediaParts,
		...songParts,
		...fontParts,
	]);

	return { blob, name: projectFileName(name), missing };
}
