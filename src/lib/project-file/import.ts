/** Read a `.openmosh` file back into storage as a new project. */

import { addTrack, getAllTracks, trackFileName } from "../audio/track-library";
import { generateId } from "../effects/types";
import { readProjectNames, setProjectName } from "../editor/project-names";
import { saveRenderSettings } from "../editor/render-settings";
import { listSavedSequences } from "../editor/saved-sequences";
import type { SeqEntry } from "../editor/seq-entry";
import { readSeqEntry } from "../editor/seq-entry";
import {
	getTimeline,
	loadMediaPool,
	putSequenceMedia,
	putTimeline,
	saveMediaPool,
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
	type ProjectManifest,
} from "./manifest";
import { entryIntact, readZip, type ReadZipEntry } from "./zip";

/** A name that isn't already in the library; a taken one gets "(copy)". */
async function availableName(name: string): Promise<string> {
	const taken = new Set((await listSavedSequences()).map((s) => s.trackName));
	if (!taken.has(name)) return name;
	let candidate = `${name} (copy)`;
	for (let n = 2; taken.has(candidate); n++) candidate = `${name} (copy ${n})`;
	return candidate;
}

/** The checksum pass reads every byte, so it's the one stage with a fraction. */
export type ProjectImportProgress =
	{ stage: "checking"; fraction: number } | { stage: "storing" };

/** What the upload screen shows while a project file opens. */
export interface ProjectOpening {
	name: string;
	stage: ProjectImportProgress["stage"] | "opening";
	percent: number;
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

/** A stored project the file would only duplicate: same pool, songs and timeline.
 * Null when there's none, or the file differs from every one. */
export async function findStoredCopy(
	project: ProjectFile,
): Promise<{ key: string; name: string } | null> {
	const { manifest, byPath } = project;
	const { sourceIds } = poolMedia(project);
	const pool = manifest.pool.map((p) => sourceIds.get(p.id) ?? p.id);

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
	const incoming = canonicalJson(
		readSeqEntry(remapProject(manifest.entry, trackIds, sourceIds), ""),
	);
	const poolJson = JSON.stringify(pool);

	for (const saved of await listSavedSequences()) {
		const storedPool = await loadMediaPool(saved.trackId);
		if (JSON.stringify(storedPool) !== poolJson) continue;
		const stored = await getTimeline(`seq:${saved.trackId}`);
		if (!stored) continue;
		if (canonicalJson(readSeqEntry(stored as SeqEntry, "")) === incoming) {
			return { key: saved.trackId, name: saved.trackName };
		}
	}
	return null;
}

/** Check and store a read project file. Returns the new project key, ready for the
 * editor's normal open path. Throws with a readable message on a damaged file or a
 * write that storage refused. */
export async function storeProjectFile(
	project: ProjectFile,
	onProgress?: (progress: ProjectImportProgress) => void,
): Promise<string> {
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

	// Held from the first media write to the pool that keeps it, so no tab's prune
	// sees the media unreferenced in between.
	const projectKey = await withMediaWrites(async () => {
		// Media first: the timeline is written last, so a failure partway leaves an
		// unregistered project whose media the next prune cleans up.
		const { sourceIds, media } = poolMedia(project);
		if (media.length > 0) await putSequenceMedia(media);

		const trackIds = new Map<string, string>();
		for (const item of manifest.songs) {
			const entry = byPath.get(item.path);
			if (!entry) continue;
			const songFile = new File([entry.blob], item.fileName, {
				type: item.type || "audio/mpeg",
			});
			const track = await addTrack(songFile);
			if (track.id !== item.trackId) trackIds.set(item.trackId, track.id);
		}

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

		const key = `proj-${generateId()}`;
		const entry = remapProject(manifest.entry, trackIds, sourceIds);
		await putTimeline(`seq:${key}`, entry);
		await saveMediaPool(
			key,
			manifest.pool.map((p) => sourceIds.get(p.id) ?? p.id),
		);
		return key;
	});
	if (manifest.render) saveRenderSettings(`seq:${projectKey}`, manifest.render);
	const name =
		manifest.name || readProjectNames()[projectKey] || "Untitled project";
	setProjectName(projectKey, await availableName(name));
	return projectKey;
}
