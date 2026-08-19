import { describe, expect, it } from "bun:test";
import { EFFECT_DEFINITIONS, FREQ_PRESETS, loadInitialEffects } from "../effects";
import { applyRandomAudioLinks, randomizeParams } from "./mosh";

/** Every link a roll produced, flattened across effects. */
function rolledLinks(band?: Parameters<typeof applyRandomAudioLinks>[3]) {
  const effects = loadInitialEffects();
  for (const e of effects) e.enabled = true;
  applyRandomAudioLinks(effects, true, 1, band);
  return effects.flatMap((e) => Object.values(e.volumeLinks ?? {}));
}

describe("applyRandomAudioLinks", () => {
  it("puts every rolled link on the chosen band", () => {
    const links = rolledLinks("low");
    expect(links.length).toBeGreaterThan(0);
    for (const link of links) {
      expect(link.freqMin).toBe(FREQ_PRESETS.low.min);
      expect(link.freqMax).toBe(FREQ_PRESETS.low.max);
    }
  });

  it("leaves the band off the link for full spectrum", () => {
    // Unset is what resolves to the overall level in applyVolumeLinksToEffects.
    for (const link of rolledLinks("full")) {
      expect(link.freqMin).toBeUndefined();
      expect(link.freqMax).toBeUndefined();
    }
  });

  it("defaults to full spectrum", () => {
    for (const link of rolledLinks()) expect(link.freqMin).toBeUndefined();
  });
});

describe("randomizeParams", () => {
  it("lands every range param on its own step grid", () => {
    for (const def of EFFECT_DEFINITIONS) {
      const values: Record<string, number | string> = {};
      // Many rolls per definition: the value is random, the grid is not.
      for (let i = 0; i < 50; i++) {
        randomizeParams(values, def);
        for (const param of def.params) {
          if (param.type !== "range" || param.step <= 0) continue;
          const v = values[param.key] as number;
          const offGrid = (v - param.min) / param.step;
          expect(Math.abs(offGrid - Math.round(offGrid))).toBeLessThan(1e-6);
          expect(v).toBeGreaterThanOrEqual(param.min);
          expect(v).toBeLessThanOrEqual(param.max);
        }
      }
    }
  });

  it("leaves a stepless range param unquantized", () => {
    const def = {
      id: "t",
      name: "T",
      params: [
        { key: "a", label: "A", type: "range", min: 0, max: 1, step: 0, defaultValue: 0 },
      ],
    } as unknown as (typeof EFFECT_DEFINITIONS)[number];
    const values: Record<string, number | string> = {};
    randomizeParams(values, def);
    expect(typeof values.a).toBe("number");
    expect(Number.isFinite(values.a as number)).toBe(true);
  });
});
