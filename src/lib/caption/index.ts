import type { EffectInstance } from "../effects/types";
import { ensureFontLoaded } from "../text-overlay";
import { CAPTION_EFFECT_ID } from "./types";

export { CAPTION_EFFECT_ID, readCaptionParams } from "./types";
export type { CaptionParams, CaptionAlign } from "./types";
export { drawCaptionToCanvas, captionSignature } from "./render-caption";

/**
 * Load every font the enabled captions need. Awaited before an export so the
 * first frames aren't rendered with a fallback face.
 */
export async function preloadCaptionFonts(
  effects: EffectInstance[],
): Promise<void> {
  const families = new Set<string>();
  for (const e of effects) {
    if (e.enabled && e.defId === CAPTION_EFFECT_ID) {
      families.add(String(e.values.font ?? ""));
    }
  }
  await Promise.all([...families].map((f) => ensureFontLoaded(f)));
}
