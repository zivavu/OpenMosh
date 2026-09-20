/**
 * User-given project names, kept apart from the song's own name.
 *
 * A project is still identified by its song, so its key is the track id — one
 * name covers the sequence, single and slideshow work under that song, the
 * way the storage manager groups them. Song-less edits use their session or
 * pool key. Kept in its own map rather than on the records so the name
 * survives the song being decoupled from the project later: whatever the
 * project key becomes, the map just needs re-keying.
 *
 * Unset means "named after the song" (or the media); callers fall back.
 */

import { readJson, writeJson } from "../storage";

const KEY = "openmosh-project-names";

const TRACK_SESSION = /^(?:single|slideshow):track:(.+)$/;

/** The project a session belongs to: its song when keyed by one, else itself. */
export function projectKeyForSession(sessionKey: string): string {
	return TRACK_SESSION.exec(sessionKey)?.[1] ?? sessionKey;
}

export function readProjectNames(): Record<string, string> {
	const raw = readJson<unknown>(KEY, null);
	return raw && typeof raw === "object" && !Array.isArray(raw)
		? (raw as Record<string, string>)
		: {};
}

export function getProjectName(key: string): string | null {
	return readProjectNames()[key] ?? null;
}

/** Blank clears the name, so the project reads as its song again. */
export function setProjectName(key: string, name: string): void {
	const names = readProjectNames();
	const next = name.trim();
	if (next) names[key] = next;
	else delete names[key];
	writeJson(KEY, names);
}

export function forgetProjectNames(keys: string[]): void {
	const names = readProjectNames();
	for (const key of keys) delete names[key];
	writeJson(KEY, names);
}

export function clearProjectNames(): void {
	writeJson(KEY, {});
}
