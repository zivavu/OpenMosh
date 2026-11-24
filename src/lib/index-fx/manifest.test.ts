import { describe, expect, test } from "bun:test";
import { CATALOG } from "../effects/catalog";
import type { CatalogEffect } from "../effects/catalog";
import { H } from "../gl/shader-lib";
import { bindEffect } from "./bindings";
import { MAX_PASS_CHARS, MAX_PASSES, toIndexManifest } from "./manifest";
import { INDEX_FX, INDEX_FX_HELD } from "./shortlist";

const provenance = {
	author: "OpenMosh",
	source: "https://example.com/effect.ts",
	adaptation: "test",
	license: "MIT",
	notice: "test",
};
const entry = (id: string) => CATALOG.find((c) => c.definition.id === id)!;
const exported = Object.keys(INDEX_FX).map((id) => ({
	id,
	manifest: toIndexManifest(entry(id), { version: "v1.0", provenance }),
}));

/** Host uniforms every pass may read; anything else u_* must be a control. */
const HOST = new Set(["uInput", "uHistory", "uResolution", "uTime", "uDelta"]);

describe("the shortlist", () => {
	test("names effects that exist, each once", () => {
		for (const id of [...Object.keys(INDEX_FX), ...Object.keys(INDEX_FX_HELD)])
			expect(entry(id)).toBeDefined();
		for (const id of Object.keys(INDEX_FX_HELD))
			expect(INDEX_FX[id]).toBeUndefined();
	});
});

describe.each(exported)("$id", ({ manifest }) => {
	// The checks the INDEX Playground's normalize() and validateFX() make.
	test("passes the host's manifest checks", () => {
		const keys = [...manifest.params, ...manifest.colors].map((c) => c.key);
		expect(new Set(keys).size).toBe(keys.length);
		for (const k of keys) {
			expect(k).toMatch(/^[A-Za-z_][A-Za-z0-9_]*$/);
			expect(k).not.toBe("time");
		}
		for (const p of manifest.params) {
			expect(p.step).toBeGreaterThan(0);
			expect(p.min).toBeLessThanOrEqual(p.default);
			expect(p.default).toBeLessThanOrEqual(p.max);
			const steps = (p.default - p.min) / p.step;
			expect(Math.abs(steps - Math.round(steps))).toBeLessThan(1e-6);
		}
		for (const c of manifest.colors)
			expect(c.default).toMatch(/^#[0-9A-F]{6}$/);
		const fx = manifest.effect;
		expect(fx.moduleId).toMatch(/^[a-z][a-z0-9-]{2,63}$/);
		expect(fx.passes.length).toBeGreaterThan(0);
		expect(fx.passes.length).toBeLessThanOrEqual(MAX_PASSES);
		for (const p of fx.passes) {
			expect(p.fragment).toMatch(/^#version 300 es\b/);
			expect(p.fragment.length).toBeLessThan(MAX_PASS_CHARS);
		}
		for (const v of Object.values(fx.provenance)) expect(v.trim()).not.toBe("");
	});

	// The host sets every control with uniform1f (colors uniform4f); a uniform of
	// another type fails the draw, and one with no control silently reads 0.
	test("declares only uniforms the host sets, as the host sets them", () => {
		const types = new Map<string, string>([
			...manifest.params.map((p) => [`u_${p.key}`, "float"] as const),
			...manifest.colors.map((c) => [`u_${c.key}`, "vec4"] as const),
		]);
		for (const { fragment } of manifest.effect.passes) {
			for (const [, type, name] of fragment.matchAll(
				/\buniform\s+(\w+)\s+(\w+)\s*;/g,
			)) {
				if (HOST.has(name)) continue;
				expect(types.has(name) ? name : `${name} (no control)`).toBe(name);
				expect(`${name}: ${type}`).toBe(`${name}: ${types.get(name)}`);
			}
		}
	});

	test("reads its history only when it asks the host for one", () => {
		const reads = manifest.effect.passes.some((p) =>
			p.fragment.includes("uniform sampler2D uHistory;"),
		);
		expect(manifest.effect.history).toBe(reads);
	});
});

describe("controls", () => {
	const params = (id: string) =>
		exported.find((e) => e.id === id)!.manifest.params;

	test("a select becomes a choice that sends its option's index", () => {
		const mode = params("channel-split").find((p) => p.key === "mode")!;
		expect(mode).toMatchObject({ min: 0, step: 1, type: "choice" });
		expect(mode.options!.map((o) => o.value)).toEqual([0, 1, 2]);
		expect(mode.max).toBe(mode.options!.length - 1);
	});

	test("a choice maps the index back to the int the shader was written for", () => {
		// Thermal's palettes are thermal=0, infrared=1, night-vision=2 in setUniforms.
		const pass = exported.find((e) => e.id === "thermal")!.manifest.effect
			.passes[0];
		expect(pass.fragment).toContain(
			"int om_palette() { int i = int(floor(u_palette + 0.5)); return i == 0 ? 0 : i == 1 ? 1 : 2; }",
		);
	});

	test("a checkbox becomes a 0/1 toggle", () => {
		expect(params("grain").find((p) => p.key === "rgb")).toMatchObject({
			min: 0,
			max: 1,
			step: 1,
			type: "toggle",
		});
	});

	test("beat sync and its divisions are left out; Speed drives the clock", () => {
		const keys = params("rgb-strobe").map((p) => p.key);
		expect(keys).toContain("speed");
		expect(keys).not.toContain("sync");
		expect(keys).not.toContain("division");
		const pass = exported.find((e) => e.id === "rgb-strobe")!.manifest.effect
			.passes[0];
		expect(pass).toMatchObject({
			fragment: expect.stringContaining("#define u_time (uTime * u_speed)"),
		});
	});

	test("a param whose uniform is named differently keeps its own key", () => {
		const vhs = exported.find((e) => e.id === "vhs")!.manifest;
		expect(vhs.params.map((p) => p.key)).toContain("static");
		expect(vhs.effect.passes[0].fragment).not.toMatch(/\bu_noise\b/);
	});
});

describe("bindEffect", () => {
	type SetUniforms = NonNullable<CatalogEffect["shader"]>["setUniforms"];
	const fake = (setUniforms: SetUniforms): CatalogEffect => ({
		definition: {
			id: "fake",
			name: "Fake",
			params: [
				{
					key: "a",
					label: "A",
					type: "range",
					min: 0,
					max: 1,
					step: 0.1,
					defaultValue: 0.5,
				},
			],
		},
		shader: { fragment: `${H}uniform float u_a;\nvoid main() {}`, setUniforms },
	});

	test("refuses a uniform computed from a param", () => {
		const e = fake((gl, l, v) => gl.uniform1f(l.u_a, (v.a as number) * 2));
		expect(() => bindEffect(e.definition, e.shader!)).toThrow(
			"isn't a as given",
		);
	});

	test("refuses a uniform no param sets", () => {
		const e = fake((gl, l, v) => {
			gl.uniform1f(l.u_a, v.a as number);
			gl.uniform1f(l.u_b, 1);
		});
		expect(() => bindEffect(e.definition, e.shader!)).toThrow(
			"u_b has no param",
		);
	});
});
