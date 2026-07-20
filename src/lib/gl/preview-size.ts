/**
 * Preview rendering resolution, decoupled from the output resolution.
 *
 * The effect chain runs one full-screen pass per enabled effect at canvas
 * resolution, so previewing a 4K source displayed at ~900 px used to burn
 * 4–16× more fill than the screen can show. The preview canvas is instead
 * sized to the output aspect fitted into the displayed area (in device
 * pixels), never upscaled past the output size. Export/save paths switch the
 * renderer to the real output resolution for the duration of the capture.
 */

export interface PreviewSize {
  width: number;
  height: number;
}

/**
 * Fit the output resolution into the displayed area (device pixels), never
 * upscaling. Unknown/unmeasured display falls back to the full output size.
 */
export function fitPreviewSize(
  outputWidth: number | undefined,
  outputHeight: number | undefined,
  displayWidth: number,
  displayHeight: number,
): PreviewSize | null {
  if (!outputWidth || !outputHeight || outputWidth <= 0 || outputHeight <= 0) {
    return null;
  }
  if (displayWidth <= 0 || displayHeight <= 0) {
    return { width: outputWidth, height: outputHeight };
  }
  const scale = Math.min(
    1,
    displayWidth / outputWidth,
    displayHeight / outputHeight,
  );
  return {
    width: Math.max(2, Math.round(outputWidth * scale)),
    height: Math.max(2, Math.round(outputHeight * scale)),
  };
}

/** Displayed size of an element in device pixels. */
export function measureDisplaySize(el: Element): {
  width: number;
  height: number;
} {
  const r = el.getBoundingClientRect();
  const dpr = window.devicePixelRatio || 1;
  return { width: Math.round(r.width * dpr), height: Math.round(r.height * dpr) };
}
