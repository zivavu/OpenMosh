import type { EffectInstance, Preset, VolumeLink } from "./types";
import { generateId } from "./types";
import { getDefinition, hydrateLinks, hydrateValues } from "./hydrate";
import { reportRemovedEffect } from "./load-report";
import { STARTER_PRESETS } from "./starter-presets";
import { readJson, readRaw, writeJson, writeRaw } from "../storage";
import { records } from "../records";

const PRESETS_KEY = "openmosh-presets";
/** Set once the starter presets have been written, so deleting them sticks. */
const SEEDED_KEY = "openmosh-presets-seeded";

export function loadPresets(): Preset[] {
	const stored = readJson<unknown>(PRESETS_KEY, null);
	if (stored !== null) return withoutRemovedEffects(stored);
	// First run: seed the starters as ordinary, editable user presets. Guarded by
	// its own key so a user who deletes them all doesn't get them back.
	if (readRaw(SEEDED_KEY) === null) {
		writeRaw(SEEDED_KEY, "1");
		writeJson(PRESETS_KEY, STARTER_PRESETS);
		return structuredClone(STARTER_PRESETS) as Preset[];
	}
	return [];
}

/** Drops effects OpenMosh no longer has, and a preset left with none, for good. A
 * damaged entry goes the same way rather than taking the whole list down with it. */
function withoutRemovedEffects(stored: unknown): Preset[] {
	let changed = !Array.isArray(stored);
	const kept: Preset[] = [];
	for (const preset of records<Preset>(stored)) {
		if (typeof preset.name !== "string" || !Array.isArray(preset.effects)) {
			changed = true;
			continue;
		}
		const all = records<Preset["effects"][number]>(preset.effects);
		if (all.length !== preset.effects.length) changed = true;
		const effects = all.filter((e): e is Preset["effects"][number] => {
			if (typeof e.defId === "string" && getDefinition(e.defId)) return true;
			if (e.enabled && typeof e.defId === "string")
				reportRemovedEffect(e.defId);
			changed = true;
			return false;
		});
		if (effects.length > 0 || preset.effects.length === 0)
			kept.push({ ...(preset as Preset), effects });
	}
	if (changed) writeJson(PRESETS_KEY, kept);
	return kept;
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

/** A painting or a loaded mask belongs to one picture, so presets leave it out. */
function withoutPaint(e: EffectInstance): Record<string, number | string> {
	const values = { ...e.values };
	for (const param of getDefinition(e.defId)?.params ?? []) {
		const scrub = param.type === "paint" || param.type === "image";
		if (scrub && param.key in values) values[param.key] = param.defaultValue;
	}
	return values;
}

/** What a preset keeps of a live chain: no instance ids, no UI state. */
function serializeEffects(effects: EffectInstance[]): Preset["effects"] {
	return effects.map((e) => ({
		defId: e.defId,
		enabled: e.enabled,
		values: withoutPaint(e),
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

/** Where `seen` sits in the stored list now: another tab may have added, moved or
 * deleted presets since this one listed them, so the index alone can name another. */
function storedIndex(presets: Preset[], index: number, seen?: Preset): number {
	if (!seen) return presets[index] ? index : -1;
	const same = (p: Preset | undefined) =>
		!!p &&
		p.name === seen.name &&
		JSON.stringify(p.effects) === JSON.stringify(seen.effects);
	return same(presets[index]) ? index : presets.findIndex(same);
}

/** `seen` is the preset as the caller listed it; without it the index is trusted. */
export function updatePreset(
	index: number,
	effects: EffectInstance[],
	seen?: Preset,
): Preset[] {
	const presets = loadPresets();
	const at = storedIndex(presets, index, seen);
	if (at === -1) return presets;
	presets[at].effects = serializeEffects(effects);
	writeJson(PRESETS_KEY, presets);
	return presets;
}

export function deletePreset(index: number, seen?: Preset): Preset[] {
	const presets = loadPresets();
	const at = storedIndex(presets, index, seen);
	if (at === -1) return presets;
	presets.splice(at, 1);
	writeJson(PRESETS_KEY, presets);
	return presets;
}

/** True for a storage event that changed the preset list. */
export function isPresetsChange(key: string | null): boolean {
	return key === null || key === PRESETS_KEY;
}

export function applyPreset(preset: Preset): EffectInstance[] {
	return preset.effects
		.filter((pe) => getDefinition(pe.defId))
		.map((pe) => {
			const links = pe.volumeLinks && hydrateLinks(pe.defId, pe.volumeLinks);
			return {
				instanceId: generateId(),
				defId: pe.defId,
				enabled: pe.enabled,
				locked: false,
				expanded: false,
				// Definition defaults underneath, so a preset saved before a param existed
				// still gets a sane value for it.
				values: hydrateValues(pe.defId, pe.values),
				...(links && { volumeLinks: links }),
			};
		});
}

const FILE_FORMAT = "openmosh-presets";
const FILE_VERSION = 1;

/** A preset file: versioned so a later shape can still read this one. */
export function presetsToFile(presets: Preset[]): Blob {
	const file = { format: FILE_FORMAT, version: FILE_VERSION, presets };
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
	// Every file this app has written carries a numeric version.
	if (
		!isRecord(data) ||
		data.format !== FILE_FORMAT ||
		typeof data.version !== "number" ||
		!Array.isArray(data.presets)
	)
		throw new Error("That isn't an OpenMosh preset file");
	if (data.version > FILE_VERSION)
		throw new Error(
			"That preset file is from a newer OpenMosh. Reload the page and try again",
		);
	const presets: Preset[] = [];
	for (const p of data.presets) {
		if (!isRecord(p) || typeof p.name !== "string" || !Array.isArray(p.effects))
			continue;
		const effects: Preset["effects"] = [];
		for (const e of p.effects) {
			if (!isRecord(e) || typeof e.defId !== "string") continue;
			if (!getDefinition(e.defId)) {
				if (e.enabled !== false) reportRemovedEffect(e.defId);
				continue;
			}
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
