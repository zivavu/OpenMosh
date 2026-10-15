/** The effects panel's search: an effect's name, or the family and chain stage a
 * curated mosh files it under, so "warp" or "rgb" finds the whole group. */

import { CURATION } from "./curation";
import type { EffectDefinition } from "./types";

export function effectMatchesSearch(
	def: Pick<EffectDefinition, "id" | "name">,
	query: string,
): boolean {
	const q = query.trim().toLowerCase();
	if (!q) return true;
	const curation = CURATION[def.id];
	return [def.name, curation?.family, curation?.stage].some((word) =>
		word?.toLowerCase().includes(q),
	);
}
