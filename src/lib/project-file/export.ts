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
function songIdsOf(entry: SeqEntry, projectKey: string): string[] {
	const ids = new Set<string>();
	if (entry.song) ids.add(entry.song);
	// A project keyed by its song predates the song field; the key is the song.
	if (!isProjectKey(projectKey)) ids.add(projectKey);
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

/** Build the file. `liveEntry` is the editor's current timeline; without it the
 * stored one is used, which may be an older format the importer still reads. */
export async function buildProjectFile(
	projectKey: string,
	liveEntry?: SeqEntry | null,
): Promise<ProjectFileResult> {
	const entry =
		liveEntry ?? ((await getTimeline(`seq:${projectKey}`)) as SeqEntry | null);
	if (!entry) throw new Error("This project has nothing saved yet");

	const poolIds = (await loadMediaPool(projectKey)) ?? [];
	const stored = await getSequenceMediaByIds(poolIds);
	const missing = poolIds.length - stored.length;

	const pool: ProjectPoolEntry[] = [];
	const mediaParts: ZipEntryInput[] = [];
	stored.forEach((item, i) => {
		const file = storedMediaToFile(item);
		const path = `media/${i}.${extOf(item.name, item.type || item.blob.type)}`;
		pool.push({
			id: item.id,
			name: item.name,
			type: item.type || item.blob.type,
			lastModified: item.lastModified ?? 0,
			path,
		});
		mediaParts.push({ name: path, blob: file });
	});

	const songs: ProjectSongEntry[] = [];
	const songParts: ZipEntryInput[] = [];
	for (const trackId of songIdsOf(entry, projectKey)) {
		const track = await getTrack(trackId).catch(() => null);
		if (!track) continue;
		const fileName = track.fileName ?? track.name;
		const path = `songs/${songs.length}.${extOf(fileName, track.blob.type)}`;
		songs.push({ trackId, name: track.name, fileName, path });
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
		const songId = entry.song ?? (isProjectKey(projectKey) ? null : projectKey);
		if (songId) {
			const track = await getTrack(songId).catch(() => null);
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
