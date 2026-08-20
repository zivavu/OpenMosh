import { EFFECT_DEFINITIONS } from "./definitions";
import { generateId, type EffectDefinition, type EffectInstance } from "./types";

/** Lookup table, not a scan: hydration runs over every instance in every
 * restored chain. */
const DEFINITIONS_BY_ID = new Map<string, EffectDefinition>(
  EFFECT_DEFINITIONS.map((d) => [d.id, d]),
);

export function getDefinition(defId: string): EffectDefinition | undefined {
  return DEFINITIONS_BY_ID.get(defId);
}

/**
 * Fill in every param a stored instance is missing, using its definition's
 * defaults.
 *
 * Anything persisted — a session, a preset, a segment, a lane clip — was
 * written against whatever params the effect had that day. Adding one later
 * means every stored chain is short a key, and the panel reads
 * `values[param.key].toString()` straight off it. Merging defaults underneath
 * is what keeps a new param from breaking every saved edit.
 */
export function hydrateValues(
  defId: string,
  values: Record<string, number | string> | undefined,
): Record<string, number | string> {
  const def = getDefinition(defId);
  if (!def) return { ...values };
  const defaults = Object.fromEntries(def.params.map((p) => [p.key, p.defaultValue]));
  return { ...defaults, ...values };
}

/**
 * Bring a stored chain back to something the editor can render: instances whose
 * definition is gone are dropped (a stale defId renders as a hole in the
 * chain), and the survivors get their missing params filled in.
 */
export function hydrateEffects(saved: unknown): EffectInstance[] {
  if (!Array.isArray(saved)) return [];
  return saved
    .filter((e: EffectInstance | null) => !!e && !!getDefinition(e.defId))
    .map((e: EffectInstance) => ({
      ...e,
      instanceId: e.instanceId ?? generateId(),
      values: hydrateValues(e.defId, e.values),
    }));
}
