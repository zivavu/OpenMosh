/** Read a `.openmosh` file back into storage as a new project or edit. */

import { addTrack, getAllTracks, trackFileName } from "../audio/track-library";
import { generateId } from "../effects/types";
import {
	projectKeyForSession,
	readProjectNames,
	setProjectName,
} from "../editor/project-names";
import { saveRenderSettings } from "../editor/render-settings";
import { listSavedSequences } from "../editor/saved-sequences";
import type { SeqEntry } from "../editor/seq-entry";
import { readSeqEntry } from "../editor/seq-entry";
import { listSavedSessions, newSessionKey } from "../editor/sessions";
import {
	getSession,
	getTimeline,
	loadMediaPool,
	putSequenceMedia,
	putSession,
	putTimeline,
	saveMediaPool,
	sessionTimelineKeys,
	stableSourceId,
	withMediaWrites,
} from "../editor/sequence-media-store";
import {
	addCustomFont,
	addCustomFontData,
} from "../text-overlay/custom-fonts.svelte";
import {
	isFetchableFontUrl,
	parseManifest,
	remapProject,
	type ProjectFileMode,
	type ProjectManifest,
} from "./manifest";
import { entryIntact, readZip, type ReadZipEntry } from "./zip";

/** What the upload screen lists for a mode: each project's key and shown name. */
async function listedProjects(
	mode: ProjectFileMode,
): Promise<{ key: string; name: string }[]> {
	if (mode === "sequence") {
		return (await listSavedSequences()).map((s) => ({
			key: s.trackId,
			name: s.trackName,
		}));
	}
	const names = readProjectNames();
	return (await listSavedSessions(mode)).map((s) => ({
		key: s.key,
		name: names[projectKeyForSession(s.key)] ?? s.label,
	}));
}

/** A name that isn't already in the mode's list; a taken one gets "(copy)". */
async function availableName(
	name: string,
	mode: ProjectFileMode,
): Promise<string> {
	const taken = new Set((await listedProjects(mode)).map((p) => p.name));
	if (!taken.has(name)) return name;
	let candidate = `${name} (copy)`;
	for (let n = 2; taken.has(candidate); n++) candidate = `${name} (copy ${n})`;
	return candidate;
}

/** The checksum pass reads every byte, so it's the one stage with a fraction. */
export type ProjectImportProgress =
	{ stage: "checking"; fraction: number } | { stage: "storing" };

/** What the opening card shows while a project file, or anything else that can
 * take a moment, opens. */
export interface ProjectOpening {
	name: string;
	stage: ProjectImportProgress["stage"] | "opening";
	percent: number;
	/** Shown only if it's still going after a moment, so a quick open doesn't flash. */
	quiet?: boolean;
}

/** A project file whose manifest has been read; its media is still unchecked. */
export interface ProjectFile {
	manifest: ProjectManifest;
	manifestEntry: ReadZipEntry;
	byPath: Map<string, ReadZipEntry>;
}

/** Parse a project file's manifest. Throws with a readable message on a file that
 * isn't one. */
export async function readProjectFile(file: Blob): Promise<ProjectFile> {
	const entries = await readZip(file);
	const byPath = new Map(entries.map((e) => [e.name, e]));
	const manifestEntry = byPath.get("project.json");
	if (!manifestEntry) throw new Error("That isn't an OpenMosh project file");

	let raw: unknown;
	try {
		raw = JSON.parse(await manifestEntry.blob.text());
	} catch {
		throw new Error("That project file is damaged");
	}
	return { manifest: parseManifest(raw), manifestEntry, byPath };
}

/** JSON with sorted keys, so two equal timelines compare equal as strings. Effect
 * instance ids are left out: reading a save can mint them fresh. */
function canonicalJson(value: unknown): string {
	return JSON.stringify(value, (key, v: unknown) =>
		key === "instanceId"
			? undefined
			: v && typeof v === "object" && !Array.isArray(v)
				? Object.fromEntries(
						Object.entries(v).sort(([a], [b]) => (a < b ? -1 : 1)),
					)
				: v,
	);
}

/** The pool's files as they'd be stored, and the ids that land differently. */
function poolMedia({ manifest, byPath }: ProjectFile) {
	const sourceIds = new Map<string, string>();
	const media: { id: string; file: File }[] = [];
	for (const item of manifest.pool) {
		const entry = byPath.get(item.path);
		if (!entry) continue;
		const file = new File([entry.blob], item.name, {
			type: item.type || entry.blob.type,
			lastModified: item.lastModified,
		});
		const id = stableSourceId(file);
		if (id !== item.id) sourceIds.set(item.id, id);
		media.push({ id, file });
	}
	return { sourceIds, media };
}

/** What two copies of a project share, as a string that compares equal for them. */
function fingerprint(parts: {
	pool: string[];
	entry: SeqEntry | null;
	state?: unknown;
	trackId?: string | null;
}): string {
	return canonicalJson({
		pool: parts.pool,
		entry: parts.entry && readSeqEntry(parts.entry, ""),
		state: parts.state ?? null,
		trackId: parts.trackId ?? null,
	});
}

/** A stored project's fingerprint, or null when it has nothing to compare. */
async function storedFingerprint(
	mode: ProjectFileMode,
	key: string,
): Promise<string | null> {
	if (mode === "sequence") {
		const entry = (await getTimeline(`seq:${key}`)) as SeqEntry | null;
		const pool = await loadMediaPool(key);
		return entry && pool ? fingerprint({ pool, entry }) : null;
	}
	const session = await getSession(key);
	if (!session) return null;
	const timelineKey = sessionTimelineKeys(session)[0];
	const entry = timelineKey
		? ((await getTimeline(timelineKey)) as SeqEntry | null)
		: null;
	return fingerprint({
		pool: session.sourceIds,
		entry,
		state: session.state,
		trackId: session.trackId,
	});
}

/** A stored project the file would only duplicate: same mode, pool, songs and
 * work. Null when there's none, or the file differs from every one. */
export async function findStoredCopy(
	project: ProjectFile,
): Promise<{ mode: ProjectFileMode; key: string; name: string } | null> {
	const { manifest, byPath } = project;
	const { sourceIds } = poolMedia(project);

	const tracks = await getAllTracks();
	const trackIds = new Map<string, string>();
	for (const item of manifest.songs) {
		const size = byPath.get(item.path)?.size;
		const local = tracks.find(
			(t) => trackFileName(t) === item.fileName && t.blob.size === size,
		);
		if (!local) return null;
		if (local.id !== item.trackId) trackIds.set(item.trackId, local.id);
	}
	const incoming = fingerprint({
		pool: manifest.pool.map((p) => sourceIds.get(p.id) ?? p.id),
		entry: manifest.entry && remapProject(manifest.entry, trackIds, sourceIds),
		state: manifest.state,
		trackId:
			manifest.trackId && (trackIds.get(manifest.trackId) ?? manifest.trackId),
	});

	for (const listed of await listedProjects(manifest.mode)) {
		if ((await storedFingerprint(manifest.mode, listed.key)) === incoming) {
			return { mode: manifest.mode, ...listed };
		}
	}
	return null;
}

/** Check and store a read project file. Returns where it landed, ready for its
 * mode's normal open path. Throws with a readable message on a damaged file or a
 * write that storage refused. */
export async function storeProjectFile(
	project: ProjectFile,
	onProgress?: (progress: ProjectImportProgress) => void,
): Promise<{ mode: ProjectFileMode; key: string }> {
	const { manifest, manifestEntry, byPath } = project;
	// Checked before anything is stored: a file damaged in transit would otherwise
	// import its media broken, with nothing said.
	const used = [
		manifestEntry,
		...[...manifest.pool, ...manifest.songs, ...manifest.fonts].flatMap(
			(item) => (item.path ? (byPath.get(item.path) ?? []) : []),
		),
	];
	const total = used.reduce((sum, entry) => sum + entry.size, 0);
	let checked = 0;
	onProgress?.({ stage: "checking", fraction: 0 });
	for (const entry of used) {
		const intact = await entryIntact(entry, (count) => {
			checked += count;
			onProgress?.({
				stage: "checking",
				fraction: total > 0 ? Math.min(checked / total, 1) : 1,
			});
		});
		if (!intact) throw new Error("That project file is damaged");
	}
	onProgress?.({ stage: "storing" });

	/** The song a single or slideshow edit plays, once it's in the library. */
	let sessionTrackId: string | undefined;
	// Held from the first media write to the pool that keeps it, so no tab's prune
	// sees the media unreferenced in between.
	const projectKey = await withMediaWrites(async () => {
		// Media first: the timeline is written last, so a failure partway leaves an
		// unregistered project whose media the next prune cleans up.
		const { sourceIds, media } = poolMedia(project);
		if (media.length > 0) await putSequenceMedia(media);

		const trackIds = new Map<string, string>();
		const storedTracks = new Set<string>();
		for (const item of manifest.songs) {
			const entry = byPath.get(item.path);
			if (!entry) continue;
			const songFile = new File([entry.blob], item.fileName, {
				type: item.type || "audio/mpeg",
			});
			const track = await addTrack(songFile);
			storedTracks.add(track.id);
			if (track.id !== item.trackId) trackIds.set(item.trackId, track.id);
		}
		const songId =
			manifest.trackId && (trackIds.get(manifest.trackId) ?? manifest.trackId);
		sessionTrackId = songId && storedTracks.has(songId) ? songId : undefined;

		for (const item of manifest.fonts) {
			try {
				if (item.path) {
					const entry = byPath.get(item.path);
					if (entry) {
						const name = item.family.replace(/^'|'$/g, "") || "Custom Font";
						await addCustomFontData(
							name,
							item.path,
							await entry.blob.arrayBuffer(),
						);
					}
				} else if (item.url && isFetchableFontUrl(item.url)) {
					await addCustomFont(item.url);
				}
			} catch {
				// Already added, or the face wouldn't load; the text falls back.
			}
		}

		const pool = manifest.pool.map((p) => sourceIds.get(p.id) ?? p.id);
		const entry =
			manifest.entry && remapProject(manifest.entry, trackIds, sourceIds);
		if (manifest.mode === "sequence") {
			const key = `proj-${generateId()}`;
			await putTimeline(`seq:${key}`, entry);
			await saveMediaPool(key, pool);
			return key;
		}
		const key = newSessionKey(manifest.mode);
		// The editor keys an edit's timeline exactly as its session.
		if (entry) await putTimeline(key, entry);
		await putSession({
			key,
			mode: manifest.mode,
			label: manifest.name || media[0]?.file.name || "Untitled",
			trackId: sessionTrackId,
			sourceIds: media.map((m) => m.id),
			state: manifest.state,
		});
		return key;
	});
	const renderKey =
		manifest.mode === "sequence"
			? `seq:${projectKey}`
			: manifest.mode === "single"
				? projectKey
				: sessionTrackId && `slideshow:${sessionTrackId}`;
	if (manifest.render && renderKey)
		saveRenderSettings(renderKey, manifest.render);
	const name =
		manifest.name || readProjectNames()[projectKey] || "Untitled project";
	setProjectName(projectKey, await availableName(name, manifest.mode));
	return { mode: manifest.mode, key: projectKey };
}
