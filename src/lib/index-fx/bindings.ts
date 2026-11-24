import { colorVec, type EffectShaderDef } from "../gl/shader-lib";
import { SYNC_KEY } from "../effects/clock-params";
import type { EffectDefinition, EffectParam } from "../effects/types";

/** How one shader uniform follows one effect param. */
export type Binding =
	| { kind: "float"; uniform: string; param: string }
	/** A range param read as a GLSL int, rounded the way uniform1i truncates. */
	| { kind: "int"; uniform: string; param: string }
	/** A select: the host sends the option's index, the shader wants `table[index]`. */
	| {
			kind: "choice";
			uniform: string;
			param: string;
			glsl: "int" | "float";
			table: number[];
	  }
	| { kind: "color"; uniform: string; param: string };

export interface EffectBindings {
	bindings: Binding[];
	/** The param the renderer integrates into u_time, when the effect has one. */
	rate?: { param: string; exponent: number };
	/** Params with no meaning outside OpenMosh, left out of the export. */
	dropped: string[];
}

type Call = { kind: "1f" | "1i" | "3fv"; value: number | number[] };

/** Run setUniforms against a fake context and return what it set, by uniform name. */
export function recordUniforms(
	shader: EffectShaderDef,
	values: Record<string, number | string>,
): Map<string, Call> {
	const calls = new Map<string, Call>();
	const locs = new Proxy({} as Record<string, WebGLUniformLocation>, {
		get: (_, name) => (typeof name === "string" ? { name } : undefined),
	});
	const at = (loc: unknown) => (loc as { name: string }).name;
	const gl = new Proxy(
		{
			uniform1f: (loc: unknown, v: number) =>
				calls.set(at(loc), { kind: "1f", value: v }),
			uniform1i: (loc: unknown, v: number) =>
				calls.set(at(loc), { kind: "1i", value: v }),
			uniform3fv: (loc: unknown, v: ArrayLike<number>) =>
				calls.set(at(loc), { kind: "3fv", value: Array.from(v) }),
		},
		{
			get: (target, name) => {
				if (name in target) return target[name as keyof typeof target];
				throw new Error(`setUniforms called gl.${String(name)}`);
			},
		},
	) as unknown as WebGL2RenderingContext;
	shader.setUniforms(gl, locs, values);
	return calls;
}

export function defaultValues(
	params: EffectParam[],
): Record<string, number | string> {
	return Object.fromEntries(params.map((p) => [p.key, p.defaultValue]));
}

/** Values a probe sets a param to; two or more, so a dependent uniform has to move. */
function probeValues(p: EffectParam): (number | string)[] {
	switch (p.type) {
		case "range":
			return [p.min, p.max, (p.min + p.max) / 2, p.defaultValue];
		case "checkbox":
			return [0, 1];
		case "select":
			return p.options.map((o) => o.value);
		case "color":
			return ["#123456", "#fedcba", p.defaultValue];
		default:
			return [];
	}
}

const same = (a: Call["value"], b: Call["value"]) =>
	JSON.stringify(a) === JSON.stringify(b);

/** Works out, by probing setUniforms one param at a time, how every param reaches the
 * shader. Throws on anything the INDEX host can't feed: a uniform computed from a
 * param, or one fed by two. */
export function bindEffect(
	definition: EffectDefinition,
	shader: EffectShaderDef,
): EffectBindings {
	const defaults = defaultValues(definition.params);
	const base = recordUniforms(shader, defaults);
	const bindings: Binding[] = [];
	const dropped: string[] = [];
	const owner = new Map<string, string>();
	const ratePar = definition.rateParam ?? "speed";
	let rate: EffectBindings["rate"];

	for (const p of definition.params) {
		const tries = probeValues(p).map((value) => ({
			value,
			calls: recordUniforms(shader, { ...defaults, [p.key]: value }),
		}));
		const moved = [...base.keys()].filter((u) =>
			tries.some((t) => !same(t.calls.get(u)!.value, base.get(u)!.value)),
		);
		if (p.key === ratePar && p.type === "range")
			rate = { param: p.key, exponent: definition.rateExponent ?? 1 };
		if (moved.length === 0) {
			if (rate?.param === p.key) {
				// Only the clock reads it.
			} else if (p.key === SYNC_KEY || p.key === "division") {
				dropped.push(p.key);
			} else {
				throw new Error(`${definition.id}: ${p.key} reaches no uniform`);
			}
			continue;
		}
		if (moved.length > 1)
			throw new Error(`${definition.id}: ${p.key} feeds ${moved.join(", ")}`);
		const uniform = moved[0];
		if (owner.has(uniform))
			throw new Error(`${definition.id}: ${uniform} has two params`);
		owner.set(uniform, p.key);
		const kind = base.get(uniform)!.kind;
		const fail = () => {
			throw new Error(`${definition.id}: ${uniform} isn't ${p.key} as given`);
		};

		if (p.type === "select") {
			const table = tries.map((t) => t.calls.get(uniform)!.value as number);
			if (kind === "3fv") fail();
			bindings.push({
				kind: "choice",
				uniform,
				param: p.key,
				glsl: kind === "1i" ? "int" : "float",
				table,
			});
		} else if (p.type === "color") {
			if (kind !== "3fv") fail();
			for (const t of tries)
				if (
					!same(
						t.calls.get(uniform)!.value,
						Array.from(colorVec(String(t.value))),
					)
				)
					fail();
			bindings.push({ kind: "color", uniform, param: p.key });
		} else {
			if (kind === "3fv") fail();
			for (const t of tries)
				if (t.calls.get(uniform)!.value !== t.value) fail();
			bindings.push({
				kind: kind === "1i" ? "int" : "float",
				uniform,
				param: p.key,
			});
		}
	}
	for (const u of base.keys())
		if (!owner.has(u)) throw new Error(`${definition.id}: ${u} has no param`);
	return { bindings, rate, dropped };
}
