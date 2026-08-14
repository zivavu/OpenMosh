import { describe, expect, it } from "bun:test";
import { FREQ_PRESETS, loadInitialEffects } from "../effects";
import { applyRandomAudioLinks } from "./mosh";

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
