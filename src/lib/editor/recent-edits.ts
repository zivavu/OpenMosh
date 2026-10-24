/** One mode's saved projects, the same rows on the upload screen and in the drawer. */

import { projectKeyForSession } from "./project-names";
import {
	listSavedSequences,
	readCachedSavedSequences,
	type SavedSequence,
} from "./saved-sequences";
import {
	listSavedSessions,
	readCachedSessions,
	type SavedSession,
} from "./sessions";
import type { ProjectMode } from "./storage-inventory";

export interface RecentEdit {
	key: string;
	/** What a rename is stored under: the song, or the edit itself. */
	projectKey: string;
	mode: ProjectMode;
	/** The name before any rename. */
	label: string;
	sourceCount: number;
	updatedAt: number;
}

function fromSequence(seq: SavedSequence): RecentEdit {
	return {
		key: seq.trackId,
		projectKey: seq.trackId,
		mode: "sequence",
		label: seq.trackName,
		sourceCount: seq.sourceCount,
		updatedAt: seq.updatedAt,
	};
}

function fromSession(session: SavedSession): RecentEdit {
	return {
		key: session.key,
		projectKey: projectKeyForSession(session.key),
		mode: session.mode,
		label: session.label,
		sourceCount: session.sourceCount,
		updatedAt: session.updatedAt,
	};
}

/** Synchronous, so a list paints on its first render. */
export function readCachedRecentEdits(mode: ProjectMode): RecentEdit[] {
	return mode === "sequence"
		? readCachedSavedSequences().map(fromSequence)
		: readCachedSessions(mode).map(fromSession);
}

export async function listRecentEdits(
	mode: ProjectMode,
): Promise<RecentEdit[]> {
	return mode === "sequence"
		? (await listSavedSequences()).map(fromSequence)
		: (await listSavedSessions(mode)).map(fromSession);
}

export function recentEditName(
	edit: RecentEdit,
	names: Record<string, string>,
): string {
	return names[edit.projectKey] ?? edit.label;
}
