import { describe, expect, it } from "bun:test";
import { CAPTION_EFFECT_ID } from "../caption/types";
import { EFFECT_DEFINITIONS } from "../effects/definitions";
import { TRACKING_EFFECT_ID } from "../tracking/types";
import { EFFECT_SHADERS } from "./effect-shaders";

/** Composited as CPU overlays instead of running a fragment shader. */
const CPU_EFFECTS = new Set<string>([TRACKING_EFFECT_ID, CAPTION_EFFECT_ID]);

/** Read by the renderer (effect clock, spectrum upload), never by a shader. */
const HOST_PARAMS = new Set(["speed", "sync", "division", "smoothing"]);

describe("EFFECT_SHADERS", () => {
  it("has a shader for every effect definition", () => {
    // Without this, a dropped entry only shows up as a console warning at
    // render time and the effect silently does nothing.
    const missing = EFFECT_DEFINITIONS.filter(
      (def) => !CPU_EFFECTS.has(def.id) && !EFFECT_SHADERS[def.id],
    ).map((def) => def.id);
    expect(missing).toEqual([]);
  });

  it("has a definition for every shader", () => {
    const ids = new Set(EFFECT_DEFINITIONS.map((def) => def.id));
    const orphans = Object.keys(EFFECT_SHADERS).filter((id) => !ids.has(id));
    expect(orphans).toEqual([]);
  });

  it("feeds every param of every effect into its shader", () => {
    // A param that setUniforms never reads is a knob wired to nothing.
    const missing: string[] = [];
    for (const def of EFFECT_DEFINITIONS) {
      const shader = EFFECT_SHADERS[def.id];
      if (!shader) continue;
      const read = new Set<string>();
      const values = new Proxy({} as Record<string, number | string>, {
        get(_t, key: string) {
          read.add(key);
          const param = def.params.find((p) => p.key === key);
          return param?.defaultValue ?? 0;
        },
      });
      shader.setUniforms(stubGl(), stubLocs(), values);
      for (const param of def.params) {
        if (HOST_PARAMS.has(param.key)) continue;
        if (!read.has(param.key)) missing.push(`${def.id}.${param.key}`);
      }
    }
    expect(missing).toEqual([]);
  });
});

/** Swallows every gl call; the test only cares which values were read. */
function stubGl(): WebGL2RenderingContext {
  return new Proxy({}, { get: () => () => {} }) as WebGL2RenderingContext;
}

/** Hands back a location for any uniform name, so no setter short-circuits. */
function stubLocs(): Record<string, WebGLUniformLocation> {
  return new Proxy({}, { get: () => ({}) }) as Record<string, WebGLUniformLocation>;
}
