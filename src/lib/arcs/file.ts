/** An Arcs pool source: a small file holding the look its clips start from, so saves,
 * project files and backups carry it the way they carry any other media. */

import { DEFAULT_ARCS_PALETTE, normalizeArcsSpec, type ArcsSpec } from "./look";
import { randomSeed } from "../rng";

const ARCS_TYPE = "application/vnd.openmosh.arcs+json";
const ARCS_SUFFIX = ".arcs.json";
/** Far past any look: a seed, a palette and the knobs. */
const MAX_ARCS_BYTES = 64 * 1024;

export const ARCS_NAME = "Arcs";

export function isArcsFile(file: File): boolean {
	return file.type === ARCS_TYPE || file.name.endsWith(ARCS_SUFFIX);
}

/** A fresh look. The seed names the file, so two sources never share an id. */
export function newArcsFile(): File {
	const spec: ArcsSpec = { seed: randomSeed(), palette: DEFAULT_ARCS_PALETTE };
	return new File([JSON.stringify(spec)], `arcs-${spec.seed}${ARCS_SUFFIX}`, {
		type: ARCS_TYPE,
	});
}

/** Null for a file too large, unreadable, or not a look. */
export async function readArcsFile(file: File): Promise<ArcsSpec | null> {
	if (file.size > MAX_ARCS_BYTES) return null;
	try {
		return normalizeArcsSpec(JSON.parse(await file.text())) ?? null;
	} catch {
		return null;
	}
}
