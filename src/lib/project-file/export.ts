/** Build a `.openmosh` project file from what's stored for a project key. */

import { getTrack } from "../audio/track-library";
import { APP_VERSION } from "../build-info";
import {
	projectKeyForSession,
	readProjectNames,
} from "../editor/project-names";
import {
	loadRenderSettings,
	type RenderSettings,
} from "../editor/render-settings";
import { isProjectKey } from "../editor/saved-sequences";
import type { SeqEntry } from "../editor/seq-entry";
import {
	getSequenceMediaByIds,
	getSession,
	getTimeline,
	loadMediaPool,
	sessionTimelineKeys,
	storedMediaToFile,
} from "../editor/sequence-media-store";
import { trackIdOf } from "../mix/types";
import type { TextTimeline } from "../text/types";
import {
	customFonts,
	getCustomFontData,
} from "../text-overlay/custom-fonts.svelte";
import {
	PROJECT_EXTENSIONS,
	PROJECT_FORMAT,
	PROJECT_VERSION,
	type ProjectFileMode,
	type ProjectFontEntry,
	type ProjectManifest,
	type ProjectPoolEntry,
	type ProjectSongEntry,
} from "./manifest";
import { showToast, updateToast } from "../components/ui/toast.svelte";
import { downloadFile } from "../utils";
import { writeZip, type ZipEntryInput } from "./zip";

export interface ProjectFileResult {
	blob: Blob;
	/** The download name, with its mode's extension. */
	name: string;
	/** Pool files and songs that were gone from storage and so weren't saved. */
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

/** A download name safe on every platform, keeping letters and digits, with the
 * mode's own extension. */
export function projectFileName(
	name: string,
	mode: ProjectFileMode = "sequence",
): string {
	const base = name
		.trim()
		.replace(/[^\p{L}\p{N}\-_. ]+/gu, "")
		.replace(/\s+/g, "-")
		.replace(/^-+|-+$/g, "");
	return `${base || "openmosh-project"}${PROJECT_EXTENSIONS[mode]}`;
}

/** The notice for pool files whose bytes were gone, so the file went without them. */
export function missingFilesNotice(missing: number): string {
	return missing === 1
		? "1 file was missing and wasn't saved"
		: `${missing} files were missing and weren't saved`;
}

/** Every library song the project plays: its main song, any on an audio lane, and
 * the song a single or slideshow edit is keyed to. */
function songIdsOf(content: ProjectContent): string[] {
	const ids = new Set<string>();
	if (content.trackId) ids.add(content.trackId);
	const entry = content.entry;
	if (entry?.song) ids.add(entry.song);
	for (const lane of entry?.media?.audioLanes ?? []) {
		for (const clip of lane.clips) {
			const track = clip.sourceId ? trackIdOf(clip.sourceId) : null;
			if (track) ids.add(track);
		}
	}
	return [...ids];
}

/** Every text timeline the project carries: the timeline's and the session's. */
function textTimelinesOf(content: ProjectContent): TextTimeline[] {
	const state = content.state as
		| { text?: TextTimeline | null; config?: { text?: TextTimeline } }
		| undefined;
	return [content.entry?.text, state?.text, state?.config?.text].filter(
		(text): text is TextTimeline => !!text,
	);
}

/** The custom fonts a text lane's face or font cycle actually names. */
function fontFamiliesOf(content: ProjectContent): Set<string> {
	const families = new Set<string>();
	for (const text of textTimelinesOf(content)) {
		for (const lane of text.lanes ?? []) {
			if (lane.style?.fontFamily) families.add(lane.style.fontFamily);
			for (const family of lane.style?.fontCycle?.fonts ?? []) {
				families.add(family);
			}
		}
	}
	return families;
}

/** What a file is built from: what's stored for a project, or what the open editor
 * has on screen, so the file doesn't wait on autosaves. */
export interface ProjectContent {
	mode: ProjectFileMode;
	/** The editor's timeline, or a single edit's; a slideshow has none. */
	entry: SeqEntry | null;
	/** A single or slideshow edit's session state. */
	state?: unknown;
	/** The song a single or slideshow edit is keyed to. */
	trackId?: string | null;
	media: { id: string; file: File }[];
	render?: RenderSettings | null;
}

/** The media under these ids, in order, and how many had lost their bytes. */
async function storedMedia(ids: string[]) {
	const stored = await getSequenceMediaByIds(ids);
	return {
		media: stored.map((item) => ({
			id: item.id,
			file: storedMediaToFile(item),
		})),
		missing: ids.length - stored.length,
	};
}

/** The stored timeline, which may be an older format the importer still reads. */
async function storedEditorProject(projectKey: string) {
	const entry = (await getTimeline(`seq:${projectKey}`)) as SeqEntry | null;
	if (!entry) throw new Error("This project has nothing saved yet");
	const { media, missing } = await storedMedia(
		(await loadMediaPool(projectKey)) ?? [],
	);
	const content: ProjectContent = {
		mode: "sequence",
		// A project keyed by its song predates the song field; the import gives it a
		// key of its own, so the song has to be named.
		entry:
			!isProjectKey(projectKey) && !entry.song
				? { ...entry, song: projectKey }
				: entry,
		media,
		render: loadRenderSettings(`seq:${projectKey}`),
	};
	return { content, missing };
}

/** A single or slideshow edit as its session and timeline stored it. */
async function storedSessionProject(key: string) {
	const session = await getSession(key);
	if (!session) throw new Error("This edit has nothing saved yet");
	const { media, missing } = await storedMedia(session.sourceIds);
	const timelineKey = sessionTimelineKeys(session)[0];
	const entry = timelineKey
		? ((await getTimeline(timelineKey)) as SeqEntry | null)
		: null;
	const content: ProjectContent = {
		mode: session.mode,
		entry,
		state: session.state,
		trackId: session.trackId ?? null,
		media,
		render:
			session.mode === "slideshow"
				? // Its song's for a slideshow saved before they were its own.
					(loadRenderSettings(key) ??
					loadRenderSettings(session.trackId && `slideshow:${session.trackId}`))
				: loadRenderSettings(timelineKey),
	};
	return { content, missing };
}

/** The project's own name, else its song's, else what its edit is labelled. */
async function projectName(
	key: string,
	content: ProjectContent,
): Promise<string> {
	const own =
		readProjectNames()[
			content.mode === "sequence" ? key : projectKeyForSession(key)
		];
	if (own) return own;
	const songId = content.trackId ?? content.entry?.song;
	const track = songId ? await getTrack(songId).catch(() => null) : null;
	if (track?.name) return track.name;
	if (content.mode === "single" && content.media[0]) {
		return content.media[0].file.name;
	}
	return content.mode === "slideshow"
		? "Untitled slideshow"
		: "Untitled project";
}

export interface ProjectFileOptions {
	/** Which kind of work `key` names; defaults to an editor project. */
	mode?: ProjectFileMode;
	/** What the open editor has on screen, in place of what's stored. */
	live?: ProjectContent;
}

async function projectContent(
	key: string,
	{ mode = "sequence", live }: ProjectFileOptions,
): Promise<{ content: ProjectContent; missing: number }> {
	if (live) return { content: live, missing: 0 };
	return mode === "sequence"
		? storedEditorProject(key)
		: storedSessionProject(key);
}

/** Build the file. */
export async function buildProjectFile(
	key: string,
	options: ProjectFileOptions = {},
): Promise<ProjectFileResult> {
	const { content, missing } = await projectContent(key, options);

	const pool: ProjectPoolEntry[] = [];
	const mediaParts: ZipEntryInput[] = [];
	content.media.forEach(({ id, file }, i) => {
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
	let missingSongs = 0;
	for (const trackId of songIdsOf(content)) {
		const track = await getTrack(trackId).catch(() => null);
		if (!track) {
			missingSongs++;
			continue;
		}
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

	const families = fontFamiliesOf(content);
	const fonts: ProjectFontEntry[] = [];
	const fontParts: ZipEntryInput[] = [];
	for (const font of customFonts()) {
		if (!families.has(font.family)) continue;
		// Embedded even when it came from a link, so opening the file fetches nothing.
		const data = await getCustomFontData(font.id);
		if (!data) continue;
		const path = `fonts/${font.id}.woff2`;
		fonts.push({ id: font.id, family: font.family, path });
		fontParts.push({ name: path, blob: new Blob([data]) });
	}

	const name = await projectName(key, content);

	const manifest: ProjectManifest = {
		format: PROJECT_FORMAT,
		version: PROJECT_VERSION,
		app: APP_VERSION,
		savedAt: Date.now(),
		name,
		mode: content.mode,
		entry: content.entry,
		...(content.mode !== "sequence" ? { state: content.state } : {}),
		...(content.trackId ? { trackId: content.trackId } : {}),
		pool,
		songs,
		fonts,
		...(content.render ? { render: content.render } : {}),
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

	return {
		blob,
		name: projectFileName(name, content.mode),
		missing: missing + missingSongs,
	};
}

/** Build the file and download it, with a toast while it builds and when it's done. */
export async function downloadProjectFile(
	key: string,
	options: ProjectFileOptions = {},
): Promise<void> {
	const progress = showToast("Building the project file…", "info", 0);
	try {
		const { blob, name, missing } = await buildProjectFile(key, options);
		downloadFile(blob, name);
		if (missing) {
			updateToast(progress, missingFilesNotice(missing), "info", 8000);
		} else updateToast(progress, "Project file downloaded", "success");
	} catch (e) {
		updateToast(
			progress,
			e instanceof Error ? e.message : "Couldn't save the project file",
			"error",
			8000,
		);
	}
}
