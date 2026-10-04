import { CATALOG } from "./catalog";
import type { EffectDefinition } from "./types";

/** Every effect, in panel order. Each one is a file in ./catalog. */
export const EFFECT_DEFINITIONS: EffectDefinition[] = CATALOG.map(
	(effect) => effect.definition,
);
