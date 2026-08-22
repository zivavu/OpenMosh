import { EFFECT_DEFINITIONS } from "./definitions";
import { hueToHex } from "../color";
import {
  generateId,
  type EffectDefinition,
  type EffectInstance,
  type EffectParam,
} from "./types";

/** Lookup table, not a scan: hydration runs over every instance in every
 * restored chain. */
const DEFINITIONS_BY_ID = new Map<string, EffectDefinition>(
  EFFECT_DEFINITIONS.map((d) => [d.id, d]),
);

export function getDefinition(defId: string): EffectDefinition | undefined {
  return DEFINITIONS_BY_ID.get(defId);
}

const HEX_COLOR = /^#[0-9a-f]{6}$/i;

/**
 * Duotone's two hue sliders became color pickers. Values saved before that
 * carry hues only — rebuild the colors the old shader would have produced
 * (shadows were the hue at 30% brightness) so they still look the same.
 */
function migrateValues(
  defId: string,
  values: Record<string, number | string>,
): Record<string, number | string> {
  if (defId !== "duotone") return values;
  const migrated = { ...values };
  if (typeof values.shadowHue === "number" && values.shadowColor == null) {
    migrated.shadowColor = hueToHex(values.shadowHue, 0.3);
  }
  if (typeof values.highlightHue === "number" && values.highlightColor == null) {
    migrated.highlightColor = hueToHex(values.highlightHue);
  }
  return migrated;
}

/**
 * Reconcile one stored value with the param as it's defined *today*.
 *
 * A param's range can narrow and a select can lose an option between the day a
 * chain was saved and the day it's restored. Left alone the stale value still
 * reaches the shader while the control renders something else — a slider pinned
 * at its min, a select showing option zero — so the panel and the output
 * disagree with no way for the user to see why.
 */
function reconcile(param: EffectParam, value: number | string): number | string {
  switch (param.type) {
    case "range": {
      const n = Number(value);
      if (!Number.isFinite(n)) return param.defaultValue;
      return Math.min(param.max, Math.max(param.min, n));
    }
    case "checkbox":
      return typeof value === "number" ? value : param.defaultValue;
    case "select":
      return param.options.some((o) => o.value === value)
        ? value
        : param.defaultValue;
    case "text":
      return typeof value === "string" ? value : param.defaultValue;
    case "color":
      return typeof value === "string" && HEX_COLOR.test(value)
        ? value
        : param.defaultValue;
  }
}

/**
 * Fill in every param a stored instance is missing, using its definition's
 * defaults, and bring the ones it does have back in line with the definition.
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
  const stored = migrateValues(defId, values ?? {});
  // Unknown keys ride along: a param that comes back under its old name should
  // find its value still there.
  const hydrated = { ...stored };
  for (const param of def.params) {
    hydrated[param.key] =
      param.key in stored
        ? reconcile(param, stored[param.key])
        : param.defaultValue;
  }
  return hydrated;
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
