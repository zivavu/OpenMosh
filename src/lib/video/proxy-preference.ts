/** Whether a video previews from a smaller copy. The "Optimize large videos" setting
 * picks the default; per-file choices that differ from it are kept beside the proxies,
 * keyed by the same content-derived id the store uses. */

import { stableSourceId } from "../editor/sequence-media-store";
import { DEFAULT_SETTINGS, loadSettings } from "../editor/settings";
import { readJson, writeJson } from "../storage";

/** Files opted out while the setting is on. */
const DISABLED_KEY = "openmosh:proxy-disabled";
/** Files opted in while the setting is off. */
const ENABLED_KEY = "openmosh:proxy-enabled";
/** Oldest choices past this are dropped; the lists are a convenience, not a record. */
const MAX_ENTRIES = 200;

/** Newest last, so trimming drops the ones longest untouched. */
function readIds(key: string): string[] {
	const raw = readJson<unknown>(key, []);
	if (!Array.isArray(raw)) return [];
	return raw.filter((id): id is string => typeof id === "string");
}

/** The "Optimize large videos" setting. */
export function proxiesByDefault(): boolean {
	return loadSettings().previewProxies ?? DEFAULT_SETTINGS.previewProxies;
}

/** Whether this file previews from the original. */
export function isProxyDisabled(file: File): boolean {
	const id = stableSourceId(file);
	return proxiesByDefault()
		? readIds(DISABLED_KEY).includes(id)
		: !readIds(ENABLED_KEY).includes(id);
}

/** Records this file's choice; one that matches the setting needs no entry. */
export function setProxyDisabled(file: File, disabled: boolean): void {
	const id = stableSourceId(file);
	const byDefault = proxiesByDefault();
	for (const key of [DISABLED_KEY, ENABLED_KEY]) {
		const ids = readIds(key).filter((entry) => entry !== id);
		const differs =
			key === DISABLED_KEY ? byDefault && disabled : !byDefault && !disabled;
		if (differs) ids.push(id);
		writeJson(key, ids.slice(-MAX_ENTRIES));
	}
}
