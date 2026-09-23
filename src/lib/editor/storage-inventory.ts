/** What the app has stored, grouped the way the user thinks about it. */

import { clearTracks, deleteTrack, getAllTracks } from "../audio/track-library";
import {
	forgetAllTrackEntries,
	forgetTrackEntries,
} from "../audio/track-persistence";
import {
	customFonts,
	getCustomFontSizes,
	removeCustomFont,
} from "../text-overlay/custom-fonts.svelte";
import {
	clearProjectNames,
	forgetProjectNames,
	projectKeyForSession,
	readProjectNames,
} from "./project-names";
import { isProjectKey, listSavedSequences } from "./saved-sequences";
import {
	clearAllSequenceStores,
	deleteMediaPool,
	deleteSequenceMedia,
	deleteSequenceProxy,
	deleteSession,
	deleteTimeline,
	getAllMediaPools,
	getAllSequenceMedia,
	getAllSequenceProxies,
	getAllSessions,
	getAllTimelines,
	type StoredMediaPool,
	type StoredSession,
	type StoredTimeline,
} from "./sequence-media-store";
import { listSavedSessions } from "./sessions";

export type ProjectMode = "sequence" | "single" | "slideshow";

export interface StorageMediaItem {
	id: string;
	name: string;
	type: string;
	size: number;
	/** Bytes of the stored preview proxy, when there is one. */
	proxySize: number;
	/** How many projects and song-less edits point at this blob. */
	refs: number;
}

export interface StorageProject {
	trackId: string;
	/** The user's name for it, else the song's. */
	name: string;
	/** Bytes of the song itself. */
	trackSize: number;
	/** Modes that have saved work against this song. */
	modes: ProjectMode[];
	media: StorageMediaItem[];
	/** Media plus proxies. Shared blobs count in full for every project. */
	mediaSize: number;
	/** Timelines and session state: the edits themselves. */
	workSize: number;
	/** Newest write across everything keyed to the song; 0 when only the song. */
	updatedAt: number;
	/** Editor projects keyed by their own id that play this song. */
	projectKeys: string[];
}

/** An edit keyed by its media rather than a song. */
export interface StorageLooseEdit {
	/** Session key or pool key, whichever backs it. */
	key: string;
	kind: "session" | "pool";
	mode: ProjectMode;
	label: string;
	media: StorageMediaItem[];
	mediaSize: number;
	workSize: number;
	updatedAt: number;
}

export interface StorageFontItem {
	id: string;
	name: string;
	size: number;
}

export interface StorageInventory {
	/** From `navigator.storage.estimate()`; null when the browser won't say. */
	usage: number | null;
	quota: number | null;
	/** Null when the API is absent; otherwise whether this origin is exempt from eviction. */
	persisted: boolean | null;
	projects: StorageProject[];
	looseEdits: StorageLooseEdit[];
	/** Media no project or loose edit references. */
	unassigned: StorageMediaItem[];
	proxyCount: number;
	fonts: StorageFontItem[];
	totals: {
		media: number;
		tracks: number;
		proxies: number;
		work: number;
		fonts: number;
	};
}

const SESSION_TRACK_PREFIX: Record<Exclude<ProjectMode, "sequence">, string> = {
	single: "single:track:",
	slideshow: "slideshow:track:",
};

/** Bytes a state record takes once serialised. */
function jsonSize(value: unknown): number {
	try {
		return new Blob([JSON.stringify(value)]).size;
	} catch {
		return 0;
	}
}

/** The library song an own-id project's timeline plays, if it saved one. */
function songOf(timeline: StoredTimeline | undefined): string | null {
	const song = (timeline?.state as { song?: unknown } | null)?.song;
	return typeof song === "string" ? song : null;
}

/** A `src:<name>:<size>:<mtime>` media id, taken apart. */
function parseSourceId(id: string): { name: string; rest: string } {
	const body = id.startsWith("src:") ? id.slice(4) : id;
	const end = body.indexOf(":");
	const encoded = end === -1 ? body : body.slice(0, end);
	let name = encoded;
	try {
		name = decodeURIComponent(encoded);
	} catch {
		// Not our encoding; the raw form is still a label.
	}
	return { name, rest: end === -1 ? "" : body.slice(end) };
}

/** The file name inside a `src:` media id, for edits keyed by their media. */
function nameFromSourceId(id: string): string {
	return parseSourceId(id).name;
}

/** Where a song-less single edit keeps its render settings (see Editor's `renderKey`). */
function renderKeyFromSourceId(id: string): string {
	const { name, rest } = parseSourceId(id);
	return `single:file:${name}${rest}`;
}

export async function loadStorageInventory(): Promise<StorageInventory> {
	const [media, pools, sessions, timelines, proxies, tracks, fonts] =
		await Promise.all([
			getAllSequenceMedia(),
			getAllMediaPools(),
			getAllSessions(),
			getAllTimelines(),
			getAllSequenceProxies(),
			getAllTracks(),
			getCustomFontSizes().catch(() => new Map<string, number>()),
		]);

	const proxySizeById = new Map(proxies.map((p) => [p.id, p.blob.size]));
	const refs = new Map<string, number>();
	const bump = (ids: string[]) => {
		for (const id of ids) refs.set(id, (refs.get(id) ?? 0) + 1);
	};
	for (const pool of pools) bump(pool.sourceIds);
	for (const session of sessions) bump(session.sourceIds);

	const itemById = new Map<string, StorageMediaItem>();
	for (const m of media) {
		itemById.set(m.id, {
			id: m.id,
			name: m.name,
			type: m.type || m.blob.type,
			size: m.blob.size,
			proxySize: proxySizeById.get(m.id) ?? 0,
			refs: refs.get(m.id) ?? 0,
		});
	}
	const resolve = (ids: string[]) => {
		const seen = new Set<string>();
		const out: StorageMediaItem[] = [];
		for (const id of ids) {
			const item = itemById.get(id);
			if (item && !seen.has(id)) {
				seen.add(id);
				out.push(item);
			}
		}
		return out;
	};
	const sizeOf = (items: StorageMediaItem[]) =>
		items.reduce((n, m) => n + m.size + m.proxySize, 0);

	const names = readProjectNames();
	const poolByKey = new Map(pools.map((p) => [p.key, p]));
	const sessionByKey = new Map(sessions.map((s) => [s.key, s]));
	const timelineByKey = new Map(timelines.map((t) => [t.key, t]));
	const trackIds = new Set(tracks.map((t) => t.id));

	/** Own-id projects grouped under the song they play, so a song lists once. */
	const ownProjectsBySong = new Map<string, StoredMediaPool[]>();
	for (const pool of pools) {
		if (!isProjectKey(pool.key)) continue;
		const song = songOf(timelineByKey.get(`seq:${pool.key}`));
		if (!song || !trackIds.has(song)) continue;
		ownProjectsBySong.set(song, [...(ownProjectsBySong.get(song) ?? []), pool]);
	}
	const songOwned = new Set(
		[...ownProjectsBySong.values()].flat().map((p) => p.key),
	);

	const projects: StorageProject[] = tracks.map((track) => {
		const id = track.id;
		const pool = poolByKey.get(id);
		const seqTimeline = timelineByKey.get(`seq:${id}`);
		const singleTimeline = timelineByKey.get(`single:${id}`);
		const singleSession = sessionByKey.get(SESSION_TRACK_PREFIX.single + id);
		const slideshowSession = sessionByKey.get(
			SESSION_TRACK_PREFIX.slideshow + id,
		);
		const ownPools = ownProjectsBySong.get(id) ?? [];
		const ownTimelines = ownPools
			.map((p) => timelineByKey.get(`seq:${p.key}`))
			.filter((t) => t !== undefined);

		const modes: ProjectMode[] = [];
		if (pool || seqTimeline || ownPools.length > 0) modes.push("sequence");
		if (singleSession || singleTimeline) modes.push("single");
		if (slideshowSession) modes.push("slideshow");

		const mediaItems = resolve([
			...(pool?.sourceIds ?? []),
			...ownPools.flatMap((p) => p.sourceIds),
			...(singleSession?.sourceIds ?? []),
			...(slideshowSession?.sourceIds ?? []),
		]);
		const records: (StoredTimeline | StoredSession | StoredMediaPool)[] = [
			pool,
			seqTimeline,
			singleTimeline,
			singleSession,
			slideshowSession,
			...ownPools,
			...ownTimelines,
		].filter((r) => r !== undefined);
		return {
			trackId: id,
			name: names[id] ?? track.name,
			trackSize: track.blob.size,
			modes,
			media: mediaItems,
			mediaSize: sizeOf(mediaItems),
			workSize:
				jsonSize(seqTimeline?.state) +
				jsonSize(singleTimeline?.state) +
				jsonSize(singleSession?.state) +
				jsonSize(slideshowSession?.state) +
				ownTimelines.reduce((n, t) => n + jsonSize(t.state), 0),
			updatedAt: records.reduce((t, r) => Math.max(t, r.updatedAt), 0),
			projectKeys: ownPools.map((p) => p.key),
		};
	});
	projects.sort(
		(a, b) => b.updatedAt - a.updatedAt || a.name.localeCompare(b.name),
	);

	const looseEdits: StorageLooseEdit[] = [];
	for (const session of sessions) {
		if (session.trackId && trackIds.has(session.trackId)) continue;
		const items = resolve(session.sourceIds);
		looseEdits.push({
			key: session.key,
			kind: "session",
			mode: session.mode,
			label: names[projectKeyForSession(session.key)] ?? session.label,
			media: items,
			mediaSize: sizeOf(items),
			workSize: jsonSize(session.state),
			updatedAt: session.updatedAt,
		});
	}
	for (const pool of pools) {
		if (trackIds.has(pool.key) || songOwned.has(pool.key)) continue;
		const items = resolve(pool.sourceIds);
		looseEdits.push({
			key: pool.key,
			kind: "pool",
			mode: "sequence",
			label: names[pool.key] ?? nameFromSourceId(pool.key),
			media: items,
			mediaSize: sizeOf(items),
			workSize:
				jsonSize(timelineByKey.get(`seq:${pool.key}`)?.state) +
				jsonSize(timelineByKey.get(`single:${pool.key}`)?.state),
			updatedAt: pool.updatedAt,
		});
	}
	looseEdits.sort((a, b) => b.updatedAt - a.updatedAt);

	const unassigned = [...itemById.values()].filter((m) => m.refs === 0);

	const fontItems: StorageFontItem[] = customFonts().map((f) => ({
		id: f.id,
		name: f.name,
		size: fonts.get(f.id) ?? 0,
	}));

	const totals = {
		media: media.reduce((n, m) => n + m.blob.size, 0),
		tracks: tracks.reduce((n, t) => n + t.blob.size, 0),
		proxies: proxies.reduce((n, p) => n + p.blob.size, 0),
		work:
			timelines.reduce((n, t) => n + jsonSize(t.state), 0) +
			sessions.reduce((n, s) => n + jsonSize(s.state), 0),
		fonts: [...fonts.values()].reduce((n, b) => n + b, 0),
	};

	let usage: number | null = null;
	let quota: number | null = null;
	let persisted: boolean | null = null;
	try {
		if (navigator.storage?.estimate) {
			const est = await navigator.storage.estimate();
			usage = est.usage ?? null;
			quota = est.quota ?? null;
		}
		if (navigator.storage?.persisted) {
			persisted = await navigator.storage.persisted();
		}
	} catch {
		// Blocked storage API; the breakdown below still stands on its own.
	}

	return {
		usage,
		quota,
		persisted,
		projects,
		looseEdits,
		unassigned,
		proxyCount: proxies.length,
		fonts: fontItems,
		totals,
	};
}

/** Delete the blobs in `ids` that nothing remaining points at, plus their proxies. */
async function dropOrphanedMedia(ids: Iterable<string>): Promise<void> {
	const candidates = new Set(ids);
	if (candidates.size === 0) return;
	const [pools, sessions] = await Promise.all([
		getAllMediaPools(),
		getAllSessions(),
	]);
	for (const pool of pools)
		for (const id of pool.sourceIds) candidates.delete(id);
	for (const s of sessions) for (const id of s.sourceIds) candidates.delete(id);
	for (const id of candidates) {
		await deleteSequenceMedia(id);
		await deleteSequenceProxy(id);
	}
}

/** The upload screen paints from these mirrors; keep them honest. */
async function refreshListCaches(): Promise<void> {
	await Promise.all([
		listSavedSequences().catch(() => {}),
		listSavedSessions("single").catch(() => {}),
		listSavedSessions("slideshow").catch(() => {}),
	]);
}

/** What deleting the project takes with it, worded for the confirm dialog. */
export function describeProjectDeletion(p: StorageProject): string {
	const own = p.media.filter((m) => m.refs <= 1).length;
	const shared = p.media.length - own;
	return (
		`Removes "${p.name}" from the library along with its timelines, sessions` +
		(own > 0 ? ` and ${own} media file${own === 1 ? "" : "s"}` : "") +
		(shared > 0
			? `. ${shared} file${shared === 1 ? "" : "s"} shared with other projects stay${shared === 1 ? "s" : ""}.`
			: ".") +
		" This can't be undone."
	);
}

export function describeLooseEditDeletion(e: StorageLooseEdit): string {
	return `Removes the saved work on "${e.label}" and any media only it uses. This can't be undone.`;
}

/** The song and everything keyed to it, in every mode. */
export async function deleteProject(project: StorageProject): Promise<void> {
	const id = project.trackId;
	for (const key of project.projectKeys) {
		await deleteMediaPool(key);
		await deleteTimeline(`seq:${key}`);
		forgetTrackEntries([key, `seq:${key}`]);
	}
	forgetProjectNames(project.projectKeys);
	await deleteMediaPool(id);
	await deleteTimeline(`seq:${id}`);
	await deleteTimeline(`single:${id}`);
	await deleteSession(SESSION_TRACK_PREFIX.single + id);
	await deleteSession(SESSION_TRACK_PREFIX.slideshow + id);
	await deleteTrack(id);
	forgetTrackEntries([id, `seq:${id}`, `single:${id}`]);
	forgetProjectNames([id]);
	await dropOrphanedMedia(project.media.map((m) => m.id));
	await refreshListCaches();
}

export async function deleteLooseEdit(edit: StorageLooseEdit): Promise<void> {
	if (edit.kind === "session") {
		await deleteSession(edit.key);
	} else {
		await deleteMediaPool(edit.key);
		await deleteTimeline(`seq:${edit.key}`);
		await deleteTimeline(`single:${edit.key}`);
	}
	// Render settings for a song-less single edit are keyed by the file, not the session.
	const keys = [edit.key, `seq:${edit.key}`, `single:${edit.key}`];
	const first = edit.media[0];
	if (edit.kind === "session" && edit.mode === "single" && first) {
		keys.push(renderKeyFromSourceId(first.id));
	}
	forgetTrackEntries(keys);
	forgetProjectNames([projectKeyForSession(edit.key)]);
	await dropOrphanedMedia(edit.media.map((m) => m.id));
	await refreshListCaches();
}

/** Media nothing refers to; only offered where no editor is open. */
export async function deleteUnassignedMedia(
	items: StorageMediaItem[],
): Promise<void> {
	await dropOrphanedMedia(items.map((m) => m.id));
}

/** Preview re-encodes; each rebuilds itself the next time its video opens. */
export async function deleteAllProxies(): Promise<void> {
	for (const p of await getAllSequenceProxies())
		await deleteSequenceProxy(p.id);
}

export async function deleteFont(id: string): Promise<void> {
	await removeCustomFont(id);
}

/** Every project, edit, song, blob and font; presets and settings are left. */
export async function deleteEverything(): Promise<void> {
	await clearAllSequenceStores();
	await clearTracks();
	for (const font of customFonts()) await removeCustomFont(font.id);
	forgetAllTrackEntries();
	clearProjectNames();
	await refreshListCaches();
}

/** Ask the browser to exempt this origin from eviction, bypassing requestPersistentStorage. */
export async function keepStorage(): Promise<boolean> {
	try {
		if (!navigator.storage?.persist) return false;
		return await navigator.storage.persist();
	} catch {
		return false;
	}
}
