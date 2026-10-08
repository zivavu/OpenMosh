import { EFFECT_DEFINITIONS } from "./definitions";
import { hueToHex } from "../color";
import { parseKeys, serializeKeys } from "./mask-keys";
import { reportRemovedEffect, reportResetSetting } from "./load-report";
import {
	generateId,
	type EffectDefinition,
	type EffectInstance,
	type EffectParam,
	type VolumeLink,
} from "./types";

/** Lookup table, not a scan: hydration runs over every restored instance. */
const DEFINITIONS_BY_ID = new Map<string, EffectDefinition>(
	EFFECT_DEFINITIONS.map((d) => [d.id, d]),
);

export function getDefinition(defId: string): EffectDefinition | undefined {
	return DEFINITIONS_BY_ID.get(defId);
}

const HEX_COLOR = /^#[0-9a-f]{6}$/i;

function migrateValues(
	defId: string,
	values: Record<string, number | string>,
): Record<string, number | string> {
	if (defId === "duotone") return migrateDuotone(values);
	if (defId === "edges") return migrateEdges(values);
	if (defId === "slices") return migrateSlices(values);
	return values;
}

/** Edges' Mix (1 = lines only) became Passthru (1 = the original behind the lines). */
function migrateEdges(
	values: Record<string, number | string>,
): Record<string, number | string> {
	if (typeof values.mix !== "number" || values.passthru != null) return values;
	return { ...values, passthru: 1 - values.mix };
}

/** Slices' Horizontal/Vertical select became an Angle slider. */
function migrateSlices(
	values: Record<string, number | string>,
): Record<string, number | string> {
	if (values.direction == null || values.angle != null) return values;
	return { ...values, angle: values.direction === "vertical" ? 90 : 0 };
}

/** Duotone's two hue sliders became color pickers; rebuild old hue-only values. */
function migrateDuotone(
	values: Record<string, number | string>,
): Record<string, number | string> {
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
		case "keys":
			return serializeKeys(parseKeys(value));
		case "image":
		case "paint":
			return typeof value === "string" && value.startsWith("data:image/")
				? value
				: param.defaultValue;
	}
}

/** A value the param has since stopped taking, as opposed to one only stored loosely. */
function noLongerFits(param: EffectParam, value: number | string): boolean {
	if (param.type === "range")
		return (
			typeof value === "number" && (value < param.min || value > param.max)
		);
	if (param.type === "select")
		return !param.options.some((o) => o.value === value);
	return false;
}

/** Fill in every param a stored instance is missing, using its definition's defaults,
 * and bring the ones it has back in line. `report` names the ones that had to move. */
export function hydrateValues(
	defId: string,
	values: Record<string, number | string> | undefined,
	report = false,
): Record<string, number | string> {
	const def = getDefinition(defId);
	if (!def) return { ...values };
	const stored = migrateValues(defId, values ?? {});
	// Unknown keys ride along: a param that comes back under its old name should
	// find its value still there.
	const hydrated = { ...stored };
	for (const param of def.params) {
		if (!(param.key in stored)) {
			hydrated[param.key] = param.defaultValue;
			continue;
		}
		hydrated[param.key] = reconcile(param, stored[param.key]);
		if (report && noLongerFits(param, stored[param.key]))
			reportResetSetting(def.name, param.label);
	}
	return hydrated;
}

/** Links survive only on params that still take one, inside the range they have now. */
export function hydrateLinks(
	defId: string,
	links: Record<string, VolumeLink> | undefined,
): Record<string, VolumeLink> | undefined {
	const def = getDefinition(defId);
	if (!def || !links || typeof links !== "object") return undefined;
	const kept: Record<string, VolumeLink> = {};
	for (const param of def.params) {
		const link = links[param.key];
		if (param.type !== "range" || !link) continue;
		const clamp = (n: unknown) =>
			typeof n === "number" && Number.isFinite(n)
				? Math.min(param.max, Math.max(param.min, n))
				: param.defaultValue;
		kept[param.key] = { ...link, min: clamp(link.min), max: clamp(link.max) };
	}
	return Object.keys(kept).length > 0 ? kept : undefined;
}

/** Bring a stored chain back to something the editor can render. Only switched-on
 * effects are reported: every saved chain lists the whole library. */
export function hydrateEffects(saved: unknown): EffectInstance[] {
	if (!Array.isArray(saved)) return [];
	const hydrated: EffectInstance[] = [];
	for (const e of saved as (EffectInstance | null | undefined)[]) {
		if (!e) continue;
		if (!getDefinition(e.defId)) {
			if (e.enabled) reportRemovedEffect(e.defId);
			continue;
		}
		hydrated.push({
			...e,
			instanceId: e.instanceId ?? generateId(),
			values: hydrateValues(e.defId, e.values, e.enabled),
			...("volumeLinks" in e && {
				volumeLinks: hydrateLinks(e.defId, e.volumeLinks),
			}),
		});
	}
	return hydrated;
}
