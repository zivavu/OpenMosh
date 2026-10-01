/** Read a `.openmosh` file back into storage as a new project. */

import { addTrack } from "../audio/track-library";
import { generateId } from "../effects/types";
import { readProjectNames, setProjectName } from "../editor/project-names";
import { listSavedSequences } from "../editor/saved-sequences";
import {
	putSequenceMedia,
	putTimeline,
	saveMediaPool,
	stableSourceId,
} from "../editor/sequence-media-store";
import {
	addCustomFont,
	addCustomFontData,
} from "../text-overlay/custom-fonts.svelte";
import { parseManifest, remapProject } from "./manifest";
import { readZip } from "./zip";

/** A name that isn't already in the library; a taken one gets "(copy)". */
async function availableName(name: string): Promise<string> {
	const taken = new Set((await listSavedSequences()).map((s) => s.trackName));
	if (!taken.has(name)) return name;
	let candidate = `${name} (copy)`;
	for (let n = 2; taken.has(candidate); n++) candidate = `${name} (copy ${n})`;
	return candidate;
}

/** Parse, validate and store a project file. Returns the new project key, ready
 * for the editor's normal open path. Throws with a readable message on a bad file
 * or a write that storage refused. */
export async function openProjectFile(file: Blob): Promise<string> {
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
	const manifest = parseManifest(raw);

	// Media first: the timeline is written last, so a failure partway leaves an
	// unregistered project whose media the next prune cleans up.
	const sourceIds = new Map<string, string>();
	const media: { id: string; file: File }[] = [];
	for (const item of manifest.pool) {
		const entry = byPath.get(item.path);
		if (!entry) continue;
		const mediaFile = new File([entry.blob], item.name, {
			type: item.type || entry.blob.type,
			lastModified: item.lastModified,
		});
		const id = stableSourceId(mediaFile);
		if (id !== item.id) sourceIds.set(item.id, id);
		media.push({ id, file: mediaFile });
	}
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
			if (item.url) await addCustomFont(item.url);
			else if (item.path) {
				const entry = byPath.get(item.path);
				if (entry) {
					const name = item.family.replace(/^'|'$/g, "") || "Custom Font";
					await addCustomFontData(
						name,
						item.path,
						await entry.blob.arrayBuffer(),
					);
				}
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
	const name = manifest.name || readProjectNames()[key] || "Untitled project";
	setProjectName(key, await availableName(name));
	return key;
}
