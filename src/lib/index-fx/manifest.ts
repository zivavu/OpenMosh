import type { CatalogEffect } from "../effects/catalog";
import { bindEffect } from "./bindings";
import { toIndexPass, type PassSource } from "./glsl";

/** A numeric control. `type` and `options` are metadata INDEX hosts keep but may not
 * draw yet; without them the control is still a working slider. */
export interface IndexParam {
	key: string;
	label: string;
	min: number;
	max: number;
	step: number;
	default: number;
	type?: "toggle" | "choice";
	options?: { value: number; label: string }[];
}

export interface IndexColor {
	key: string;
	label: string;
	default: string;
}

export interface Provenance {
	author: string;
	source: string;
	adaptation: string;
	license: string;
	notice: string;
}

/** INDEX_TOOL for a provisional `fragment-webgl2` effect (effect API v2). */
export interface IndexFxManifest {
	schemaVersion: 1;
	role: "effect";
	name: string;
	version: string;
	author: string;
	capabilities: {
		requires: {
			renderer: "fragment-webgl2";
			visualInput: "lower-composite";
			audioInput: "none";
		};
		supports: { colorOpacity: false };
	};
	params: IndexParam[];
	colors: IndexColor[];
	audio: string[];
	effect: {
		apiVersion: 2;
		type: "fragment-webgl2";
		moduleId: string;
		moduleVersion: string;
		history: boolean;
		passes: { fragment: string }[];
		provenance: Provenance;
	};
}

/** The INDEX host's limits, from its validateFX. */
export const MAX_PASSES = 3;
export const MAX_PASS_CHARS = 32768;

export interface ExportOptions {
	version: string;
	provenance: Provenance;
}

function passSources(
	shader: NonNullable<CatalogEffect["shader"]>,
): PassSource[] {
	const pre = shader.prePasses ?? [];
	for (const p of pre)
		if (p.feedback || p.pyramid)
			throw new Error("pre-pass with its own history or a mip pyramid");
	return [
		...pre.map((p) => ({ fragment: p.fragment, linear: !!p.linearFilter })),
		// After pre-passes OpenMosh reads the result back LINEAR.
		{
			fragment: shader.fragment,
			linear: !!shader.linearFilter || pre.length > 0,
		},
	];
}

export function toIndexManifest(
	{ definition, shader }: CatalogEffect,
	{ version, provenance }: ExportOptions,
): IndexFxManifest {
	if (!shader) throw new Error(`${definition.id} has no shader`);
	if (definition.needsAudio) throw new Error(`${definition.id} needs audio`);
	const bound = bindEffect(definition, shader);
	const sources = passSources(shader);
	if (sources.length > MAX_PASSES)
		throw new Error(`${definition.id} needs ${sources.length} passes`);
	const passes = sources.map((s) => ({ fragment: toIndexPass(s, bound) }));
	for (const p of passes)
		if (p.fragment.length > MAX_PASS_CHARS)
			throw new Error(
				`${definition.id}: a pass is over ${MAX_PASS_CHARS} chars`,
			);

	const params: IndexParam[] = [];
	const colors: IndexColor[] = [];
	for (const p of definition.params) {
		if (bound.dropped.includes(p.key)) continue;
		const { key, label } = p;
		switch (p.type) {
			case "range":
				params.push({
					key,
					label,
					min: p.min,
					max: p.max,
					step: p.step,
					default: p.defaultValue,
				});
				break;
			case "checkbox":
				params.push({
					key,
					label,
					min: 0,
					max: 1,
					step: 1,
					default: p.defaultValue,
					type: "toggle",
				});
				break;
			case "select": {
				const at = p.options.findIndex((o) => o.value === p.defaultValue);
				params.push({
					key,
					label,
					min: 0,
					max: p.options.length - 1,
					step: 1,
					default: Math.max(0, at),
					type: "choice",
					options: p.options.map((o, value) => ({ value, label: o.label })),
				});
				break;
			}
			case "color":
				colors.push({ key, label, default: p.defaultValue.toUpperCase() });
				break;
			default:
				throw new Error(`${definition.id}: no INDEX control for ${p.type}`);
		}
	}

	return {
		schemaVersion: 1,
		role: "effect",
		name: definition.name,
		version,
		author: provenance.author,
		capabilities: {
			requires: {
				renderer: "fragment-webgl2",
				visualInput: "lower-composite",
				audioInput: "none",
			},
			supports: { colorOpacity: false },
		},
		params,
		colors,
		audio: params.filter((p) => !p.type).map((p) => p.key),
		effect: {
			apiVersion: 2,
			type: "fragment-webgl2",
			moduleId: `openmosh-${definition.id}`,
			moduleVersion: version,
			history: passes.some((p) =>
				p.fragment.includes("uniform sampler2D uHistory;"),
			),
			passes,
			provenance,
		},
	};
}
