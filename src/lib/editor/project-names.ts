/** User-given project names, kept apart from the song's own name. Keyed by track id
 * so one name covers a song's sequence/single/slideshow work; unset falls back to it. */

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
