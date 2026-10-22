import { readJson, writeJson } from "../storage";

/** Library songs with loudness normalization on, by track id. */
export const NORMALIZE_KEY = "openmosh-library-normalize";

export function readNormalizedTracks(): Set<string> {
	return new Set(readJson<string[]>(NORMALIZE_KEY, []));
}

export function writeNormalizedTracks(ids: Iterable<string>): void {
	writeJson(NORMALIZE_KEY, [...ids]);
}
