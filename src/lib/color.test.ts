import { describe, expect, it } from "bun:test";
import { hexToHsv, hexToRgb, hexToVec3, hsvToHex, hueToHex, normalizeHex } from "./color";
import { applyPreset } from "./effects/presets";

describe("hex parsing", () => {
  it("accepts short, long and unprefixed hex", () => {
    expect(hexToRgb("#f80")).toEqual({ r: 255, g: 136, b: 0 });
    expect(hexToRgb("ff8800")).toEqual({ r: 255, g: 136, b: 0 });
    expect(hexToRgb("#FF8800")).toEqual({ r: 255, g: 136, b: 0 });
  });

  it("rejects anything else", () => {
    expect(hexToRgb("#ff88")).toBeNull();
    expect(hexToRgb("nope")).toBeNull();
    expect(hexToRgb("")).toBeNull();
  });

  it("falls back while a hex is half-typed", () => {
    expect(normalizeHex("#ff88", "#000000")).toBe("#000000");
    expect(normalizeHex("#abc", "#000000")).toBe("#aabbcc");
  });

  it("converts to 0–1 channels for uniforms", () => {
    expect(hexToVec3("#ff0000")).toEqual([1, 0, 0]);
    expect(hexToVec3("bogus", "#000000")).toEqual([0, 0, 0]);
  });
});

describe("hsv round trip", () => {
  it("survives a round trip through hsv", () => {
    for (const hex of ["#000000", "#ffffff", "#20004d", "#00ffea", "#7f3f1f"]) {
      expect(hsvToHex(hexToHsv(hex))).toBe(hex);
    }
  });

  it("matches the hue ramp the duotone shader used", () => {
    // Old shader: hsl2rgb(hue) for highlights, the same * 0.3 for shadows.
    expect(hueToHex(175)).toBe("#00ffea");
    expect(hueToHex(265, 0.3)).toBe("#20004d");
  });
});

describe("duotone preset migration", () => {
  it("rebuilds colors from legacy hues", () => {
    const [effect] = applyPreset({
      name: "legacy",
      effects: [
        {
          defId: "duotone",
          enabled: true,
          values: { shadowHue: 265, highlightHue: 175, intensity: 0.55 },
        },
      ],
    });
    expect(effect.values.shadowColor).toBe("#20004d");
    expect(effect.values.highlightColor).toBe("#00ffea");
    expect(effect.values.intensity).toBe(0.55);
  });

  it("leaves saved colors alone", () => {
    const [effect] = applyPreset({
      name: "current",
      effects: [
        {
          defId: "duotone",
          enabled: true,
          values: { shadowHue: 265, shadowColor: "#123456" },
        },
      ],
    });
    expect(effect.values.shadowColor).toBe("#123456");
  });
});
