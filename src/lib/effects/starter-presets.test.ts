import { describe, expect, it } from "bun:test";
import { EFFECT_DEFINITIONS } from "./definitions";
import { normalizePresetName, PRESET_NAME_MAX_LENGTH } from "./presets";
import { STARTER_PRESETS } from "./starter-presets";

const defById = new Map(EFFECT_DEFINITIONS.map((d) => [d.id, d]));

describe("normalizePresetName", () => {
  it("trims surrounding whitespace", () => {
    expect(normalizePresetName("  glitchy  ")).toBe("glitchy");
  });

  it("truncates to the maximum length", () => {
    const name = normalizePresetName("x".repeat(PRESET_NAME_MAX_LENGTH + 20));
    expect(name.length).toBe(PRESET_NAME_MAX_LENGTH);
  });

  it("doesn't leave trailing whitespace after truncating mid-word", () => {
    const name = normalizePresetName("x".repeat(PRESET_NAME_MAX_LENGTH - 1) + " yz");
    expect(name).toBe("x".repeat(PRESET_NAME_MAX_LENGTH - 1));
  });

  it("collapses an all-whitespace name to empty, so saving is rejected", () => {
    expect(normalizePresetName("   ")).toBe("");
  });
});

describe("starter presets", () => {
  it("have unique names", () => {
    const names = STARTER_PRESETS.map((p) => p.name);
    expect(new Set(names).size).toBe(names.length);
  });

  it("fit within the preset name limit", () => {
    for (const preset of STARTER_PRESETS) {
      expect(preset.name.length).toBeLessThanOrEqual(PRESET_NAME_MAX_LENGTH);
    }
  });

  for (const preset of STARTER_PRESETS) {
    describe(preset.name, () => {
      it("references only known effects and params", () => {
        for (const entry of preset.effects) {
          const def = defById.get(entry.defId);
          expect(def, `unknown effect "${entry.defId}"`).toBeDefined();
          const paramKeys = new Set(def!.params.map((p) => p.key));
          for (const key of Object.keys(entry.values)) {
            expect(paramKeys.has(key), `${entry.defId}.${key}`).toBe(true);
          }
        }
      });

      it("keeps values inside each param's range", () => {
        for (const entry of preset.effects) {
          for (const param of defById.get(entry.defId)!.params) {
            const value = entry.values[param.key];
            if (value === undefined) continue;
            const where = `${entry.defId}.${param.key}`;
            if (param.type === "range") {
              expect(typeof value, where).toBe("number");
              expect(value as number, where).toBeGreaterThanOrEqual(param.min);
              expect(value as number, where).toBeLessThanOrEqual(param.max);
            } else if (param.type === "select") {
              expect(
                param.options.some((o) => o.value === value),
                `${where} = "${value}"`,
              ).toBe(true);
            } else {
              expect([0, 1], where).toContain(value as number);
            }
          }
        }
      });

      it("only links range params, within their range", () => {
        for (const entry of preset.effects) {
          if (!entry.volumeLinks) continue;
          const params = new Map(
            defById.get(entry.defId)!.params.map((p) => [p.key, p]),
          );
          for (const [key, link] of Object.entries(entry.volumeLinks)) {
            const param = params.get(key);
            const where = `${entry.defId}.${key}`;
            // Non-range params are skipped outright by applyVolumeLinksToEffects
            expect(param?.type, where).toBe("range");
            if (param?.type !== "range") continue;
            expect(link.min, where).toBeGreaterThanOrEqual(param.min);
            expect(link.max, where).toBeLessThanOrEqual(param.max);
            expect(link.min, where).toBeLessThan(link.max);
          }
        }
      });

      it("links to the full spectrum", () => {
        for (const entry of preset.effects) {
          for (const [key, link] of Object.entries(entry.volumeLinks ?? {})) {
            // Both bounds unset makes the link follow overall RMS level
            expect(link.freqMin, `${entry.defId}.${key}`).toBeUndefined();
            expect(link.freqMax, `${entry.defId}.${key}`).toBeUndefined();
          }
        }
      });
    });
  }
});
