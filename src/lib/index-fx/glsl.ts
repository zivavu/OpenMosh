import { EFFECT_FRAME_SHORT_SIDE, H } from "../gl/shader-lib";
import type { Binding, EffectBindings } from "./bindings";

/** What one INDEX pass needs to know about the OpenMosh pass it comes from. */
export interface PassSource {
	fragment: string;
	/** OpenMosh samples this pass's input LINEAR; otherwise NEAREST. */
	linear: boolean;
}

const word = (name: string) => new RegExp(`\\b${name}\\b`, "g");

function declaration(type: string, name: string) {
	return new RegExp(
		`^[ \\t]*uniform\\s+${type}\\s+${name}\\s*;[ \\t]*\\n?`,
		"m",
	);
}

function removeDeclaration(body: string, type: string, name: string) {
	return body.replace(declaration(type, name), "");
}

function float(n: number) {
	const s = String(n);
	return /[.e]/.test(s) ? s : `${s}.0`;
}

/** The uniform the INDEX host sets for a param, and the GLSL that turns it back
 * into what the OpenMosh shader reads. */
function rebind(body: string, b: Binding): { body: string; decls: string[] } {
	const host = `u_${b.param}`;
	const from = b.uniform;
	const glslType =
		b.kind === "color"
			? "vec3"
			: b.kind === "float"
				? "float"
				: b.kind === "int"
					? "int"
					: b.glsl;
	if (!declaration(glslType, from).test(body))
		throw new Error(`no "uniform ${glslType} ${from};" to rebind`);
	if (from !== host && word(host).test(body))
		throw new Error(`${host} is already taken`);
	body = removeDeclaration(body, glslType, from);

	switch (b.kind) {
		case "float":
			return {
				body: body.replace(word(from), host),
				decls: [`uniform float ${host};`],
			};
		case "color":
			return {
				body: body.replace(word(from), `${host}.rgb`),
				decls: [`uniform vec4 ${host};`],
			};
		case "int": {
			const fn = `om_${b.param}`;
			return {
				body: body.replace(word(from), `${fn}()`),
				decls: [
					`uniform float ${host};`,
					`int ${fn}() { return int(floor(${host} + 0.5)); }`,
				],
			};
		}
		case "choice": {
			const fn = `om_${b.param}`;
			const lit = (v: number) =>
				b.glsl === "int" ? String(Math.trunc(v)) : float(v);
			const last = b.table.length - 1;
			const arms = b.table
				.slice(0, last)
				.map((v, i) => `i == ${i} ? ${lit(v)} : `)
				.join("");
			return {
				body: body.replace(word(from), `${fn}()`),
				decls: [
					`uniform float ${host};`,
					`${b.glsl} ${fn}() { int i = int(floor(${host} + 0.5)); return ${arms}${lit(b.table[last])}; }`,
				],
			};
		}
	}
}

function rateExpr(rate: EffectBindings["rate"]) {
	if (!rate) return "1.0";
	const u = `u_${rate.param}`;
	return rate.exponent === 1
		? u
		: `pow(max(${u}, 0.0), ${float(rate.exponent)})`;
}

/** OpenMosh's chain buffers are top-down, MIRRORED_REPEAT and NEAREST unless an
 * effect asks for LINEAR; INDEX's are bottom-up, CLAMP_TO_EDGE and LINEAR. Every
 * texture() read goes through these so the shader sees what it was written for. */
const SAMPLING = `vec2 omMirror(vec2 uv) {
  vec2 m = mod(uv, 2.0);
  return mix(m, 2.0 - m, step(1.0, m));
}
vec4 omNearest(sampler2D s, vec2 uv) {
  ivec2 size = textureSize(s, 0);
  ivec2 p = clamp(ivec2(floor(omMirror(uv) * vec2(size))), ivec2(0), size - 1);
  return texelFetch(s, ivec2(p.x, size.y - 1 - p.y), 0);
}
vec4 omLinear(sampler2D s, vec2 uv) {
  vec2 m = omMirror(uv);
  return texture(s, vec2(m.x, 1.0 - m.y));
}
`;

/** Rewrites one OpenMosh effect pass as an INDEX fragment-webgl2 pass. The body is
 * left as written; only declarations change, and #defines map OpenMosh's names onto
 * the host's (uInput, uHistory, uTime, uDelta, uResolution, vUV). */
export function toIndexPass(
	pass: PassSource,
	{ bindings, rate }: EffectBindings,
): string {
	if (!pass.fragment.startsWith(H))
		throw new Error("pass doesn't start with the shared header");
	let body = pass.fragment.slice(H.length);
	if (word("u_original").test(body))
		throw new Error("reads u_original, which INDEX passes don't get");

	const usesHistory = word("u_feedback").test(body);
	body = removeDeclaration(body, "sampler2D", "u_feedback");
	body = removeDeclaration(body, "vec2", "u_resolution");
	body = removeDeclaration(body, "float", "u_delta");

	const decls: string[] = [];
	for (const b of bindings) {
		if (!word(b.uniform).test(body)) continue;
		const out = rebind(body, b);
		body = out.body;
		decls.push(...out.decls);
	}
	const rateUniform = rate ? `u_${rate.param}` : null;
	if (rateUniform && !decls.includes(`uniform float ${rateUniform};`))
		decls.push(`uniform float ${rateUniform};`);

	body = body
		.replace(/\bgl_FragCoord\b/g, "omFragCoord")
		.replace(/\btexture\s*\(\s*u_feedback\b/g, "omNearest(u_feedback")
		.replace(/\btexture\s*\(/g, pass.linear ? "omLinear(" : "omNearest(");

	const frame = float(EFFECT_FRAME_SHORT_SIDE);
	return `#version 300 es
precision highp float;
uniform sampler2D uInput;
${usesHistory ? "uniform sampler2D uHistory;\n" : ""}uniform vec2 uResolution;
uniform float uTime;
uniform float uDelta;
in vec2 vUV;
out vec4 outColor;
${decls.join("\n")}
#define u_texture uInput
#define u_feedback uHistory
#define v_uv vec2(vUV.x, 1.0 - vUV.y)
#define u_time (uTime * ${rateExpr(rate)})
#define u_delta (uDelta * ${rateExpr(rate)})
#define u_resolution (uResolution * (${frame} / max(min(uResolution.x, uResolution.y), 1.0)))
#define omFragCoord vec4(gl_FragCoord.x, uResolution.y - gl_FragCoord.y, gl_FragCoord.zw)
${SAMPLING}${body}`;
}

export function readsHistory(fragment: string) {
	return word("u_feedback").test(fragment);
}
