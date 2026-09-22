import { EFFECT_DEFINITIONS } from "./definitions";
import { hueToHex } from "../color";
import {
	generateId,
	type EffectDefinition,
	type EffectInstance,
	type EffectParam,
} from "./types";

/** Lookup table, not a scan: hydration runs over every restored instance. */
const DEFINITIONS_BY_ID = new Map<string, EffectDefinition>(
	EFFECT_DEFINITIONS.map((d) => [d.id, d]),
);

export function getDefinition(defId: string): EffectDefinition | undefined {
	return DEFINITIONS_BY_ID.get(defId);
}

const HEX_COLOR = /^#[0-9a-f]{6}$/i;

/** Duotone's two hue sliders became color pickers; rebuild old hue-only values. */
function migrateValues(
	defId: string,
	values: Record<string, number | string>,
): Record<string, number | string> {
	if (defId !== "duotone") return values;
	const migrated = { ...values };
	if (typeof values.shadowHue === "number" && values.shadowColor == null) {
		migrated.shadowColor = hueToHex(values.shadowHue, 0.3);
	}
	if (
		typeof values.highlightHue === "number" &&
		values.highlightColor == null
	) {
		migrated.highlightColor = hueToHex(values.highlightHue);
	}
	return migrated;
}

/** Reconcile one stored value with the param as it's defined today: a narrowed range
 * or dropped select option would otherwise leave the panel and output disagreeing. */
function reconcile(
	param: EffectParam,
	value: number | string,
): number | string {
	switch (param.type) {
		case "range": {
			// Not Number() alone: it reads "" and "   " as 0, which pins the slider
			// to its min instead of falling back to the value the effect shipped with.
			const blank = typeof value === "string" && value.trim() === "";
			const n = blank ? NaN : Number(value);
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

/** Fill in every param a stored instance is missing, using its definition's defaults,
 * and bring the ones it has back in line. */
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

/** Bring a stored chain back to something the editor can render. */
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
