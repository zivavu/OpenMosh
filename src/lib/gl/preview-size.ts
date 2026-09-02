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
 * Ceiling on the preview buffer while the displayed size is still unknown.
 *
 * Falling back to the output resolution there is the opposite of what this
 * module is for: a 4K source would allocate the canvas, both ping-pong
 * buffers, the present buffer and every feedback buffer at 8 megapixels — the
 * largest thing the app ever asks of a GPU — at the one moment it knows least
 * about what it needs. An element that is merely hidden measures 0 too, so
 * this isn't only a first-frame case.
 */
const UNMEASURED_MAX_PIXELS = 1280 * 720;

/**
 * Fit the output resolution into the displayed area (device pixels), never
 * upscaling. An unmeasured display gets a bounded guess rather than the full
 * output size — see UNMEASURED_MAX_PIXELS.
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
  const scale =
    displayWidth <= 0 || displayHeight <= 0
      ? Math.sqrt(UNMEASURED_MAX_PIXELS / (outputWidth * outputHeight))
      : Math.min(displayWidth / outputWidth, displayHeight / outputHeight);
  const k = Math.min(1, scale);
  return {
    width: Math.max(2, Math.round(outputWidth * k)),
    height: Math.max(2, Math.round(outputHeight * k)),
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
