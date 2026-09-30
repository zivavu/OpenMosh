import type { EffectInstance, Preset, VolumeLink } from "./types";
import { generateId } from "./types";
import { getDefinition, hydrateValues } from "./hydrate";
import { STARTER_PRESETS } from "./starter-presets";
import { readJson, readRaw, writeJson, writeRaw } from "../storage";

const PRESETS_KEY = "openmosh-presets";
/** Set once the starter presets have been written, so deleting them sticks. */
const SEEDED_KEY = "openmosh-presets-seeded";

export function loadPresets(): Preset[] {
	const stored = readJson<Preset[] | null>(PRESETS_KEY, null);
	if (stored !== null) return stored;
	// First run: seed the starters as ordinary, editable user presets. Guarded by
	// its own key so a user who deletes them all doesn't get them back.
	if (readRaw(SEEDED_KEY) === null) {
		writeRaw(SEEDED_KEY, "1");
		writeJson(PRESETS_KEY, STARTER_PRESETS);
		return structuredClone(STARTER_PRESETS) as Preset[];
	}
	return [];
}

/** Names only ever render in narrow one-line rows. */
export const PRESET_NAME_MAX_LENGTH = 40;

export function normalizePresetName(name: string): string {
	return name.trim().slice(0, PRESET_NAME_MAX_LENGTH).trim();
}

/** A spread alone leaves every link object shared with the chain it came from. */
function copyLinks(
	links: Record<string, VolumeLink>,
): Record<string, VolumeLink> {
	return Object.fromEntries(
		Object.entries(links).map(([key, link]) => [key, { ...link }]),
	);
}

/** What a preset keeps of a live chain: no instance ids, no UI state. */
function serializeEffects(effects: EffectInstance[]): Preset["effects"] {
	return effects.map((e) => ({
		defId: e.defId,
		enabled: e.enabled,
		values: { ...e.values },
		...(e.volumeLinks &&
			Object.keys(e.volumeLinks).length > 0 && {
				volumeLinks: copyLinks(e.volumeLinks),
			}),
	}));
}

export function savePreset(name: string, effects: EffectInstance[]): Preset[] {
	const presets = loadPresets();
	presets.push({
		name: normalizePresetName(name),
		effects: serializeEffects(effects),
	});
	writeJson(PRESETS_KEY, presets);
	return presets;
}

export function updatePreset(
	index: number,
	effects: EffectInstance[],
): Preset[] {
	const presets = loadPresets();
	presets[index].effects = serializeEffects(effects);
	writeJson(PRESETS_KEY, presets);
	return presets;
}

export function deletePreset(index: number): Preset[] {
	const presets = loadPresets();
	presets.splice(index, 1);
	writeJson(PRESETS_KEY, presets);
	return presets;
}

export function applyPreset(preset: Preset): EffectInstance[] {
	return preset.effects.map((pe) => ({
		instanceId: generateId(),
		defId: pe.defId,
		enabled: pe.enabled,
		locked: false,
		expanded: false,
		// Definition defaults underneath, so a preset saved before a param existed
		// still gets a sane value for it.
		values: hydrateValues(pe.defId, pe.values),
		...(pe.volumeLinks && { volumeLinks: copyLinks(pe.volumeLinks) }),
	}));
}

const FILE_FORMAT = "openmosh-presets";

/** A preset file: versioned so a later shape can still read this one. */
export function presetsToFile(presets: Preset[]): Blob {
	const file = { format: FILE_FORMAT, version: 1, presets };
	return new Blob([JSON.stringify(file, null, "	")], {
		type: "application/json",
	});
}

export function presetFileName(presets: Preset[]): string {
	const base =
		presets.length === 1
			? presets[0].name.replace(/[^\w-]+/g, "-").replace(/^-|-$/g, "") ||
				"preset"
			: "presets";
	return `openmosh-${base}.json`;
}

function isRecord(v: unknown): v is Record<string, unknown> {
	return typeof v === "object" && v !== null && !Array.isArray(v);
}

/** Reads a preset file, keeping what this build understands: effects it doesn't
 * know are dropped, and so is a preset left with none. Throws on anything else. */
export function parsePresetFile(text: string): Preset[] {
	let data: unknown;
	try {
		data = JSON.parse(text);
	} catch {
		throw new Error("That file isn't valid JSON");
	}
	if (
		!isRecord(data) ||
		data.format !== FILE_FORMAT ||
		!Array.isArray(data.presets)
	)
		throw new Error("That isn't an OpenMosh preset file");
	const presets: Preset[] = [];
	for (const p of data.presets) {
		if (!isRecord(p) || typeof p.name !== "string" || !Array.isArray(p.effects))
			continue;
		const effects: Preset["effects"] = [];
		for (const e of p.effects) {
			if (
				!isRecord(e) ||
				typeof e.defId !== "string" ||
				!getDefinition(e.defId)
			)
				continue;
			effects.push({
				defId: e.defId,
				enabled: e.enabled !== false,
				values: isRecord(e.values)
					? (e.values as Preset["effects"][number]["values"])
					: {},
				...(isRecord(e.volumeLinks) && {
					volumeLinks: e.volumeLinks as Record<string, VolumeLink>,
				}),
			});
		}
		const name = normalizePresetName(p.name);
		if (name && effects.length > 0) presets.push({ name, effects });
	}
	if (presets.length === 0)
		throw new Error("No presets in that file work here");
	return presets;
}

/** Appends imported presets, numbering a name that's already taken. */
export function importPresets(incoming: Preset[]): Preset[] {
	const presets = loadPresets();
	const taken = new Set(presets.map((p) => p.name));
	for (const p of incoming) {
		let name = p.name;
		for (let n = 2; taken.has(name); n++) {
			const suffix = ` (${n})`;
			name = p.name.slice(0, PRESET_NAME_MAX_LENGTH - suffix.length) + suffix;
		}
		taken.add(name);
		presets.push({ ...p, name });
	}
	writeJson(PRESETS_KEY, presets);
	return presets;
}
