/**
 * Which videos the user has told us not to build a preview proxy for.
 *
 * Kept beside the proxies themselves rather than in a song: the choice is
 * about one file on one machine ("this clip looks wrong scaled down", "I want
 * to judge the grain"), so it belongs to the media, not to the edit. Keyed by
 * the same content-derived id the proxy store uses, so opting a file out in
 * slideshow mode also opts it out when the same file lands in a sequence pool.
 *
 * localStorage rather than IndexedDB: it's a handful of short strings, and it
 * has to be readable synchronously while a source is being built — an async
 * lookup there would start the transcode the user already declined.
 */

import { stableSourceId } from "../editor/sequence-media-store";
import { readJson, writeJson } from "../storage";

const KEY = "openmosh:proxy-disabled";
/** Oldest opt-outs past this are dropped; the list is a convenience, not a record. */
const MAX_ENTRIES = 200;

/** Newest last, so trimming drops the ones longest untouched. */
function readIds(): string[] {
	const raw = readJson<unknown>(KEY, []);
	if (!Array.isArray(raw)) return [];
	return raw.filter((id): id is string => typeof id === "string");
}

/** Whether the user asked this file to preview from the original. */
export function isProxyDisabled(file: File): boolean {
	return readIds().includes(stableSourceId(file));
}

/** Records (or clears) the opt-out for this file. */
export function setProxyDisabled(file: File, disabled: boolean): void {
	const id = stableSourceId(file);
	const ids = readIds().filter((entry) => entry !== id);
	if (disabled) ids.push(id);
	writeJson(KEY, ids.slice(-MAX_ENTRIES));
}
