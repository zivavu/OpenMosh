import { drawOverlayText, overlayTextSignature } from "../text-overlay";
import type { CaptionParams } from "./types";

/**
 * Draw a caption onto a 2D canvas with a transparent background. The renderer
 * blends it over the chain, so opacity and blend mode are not applied here.
 */
export function drawCaptionToCanvas(
	canvas: HTMLCanvasElement,
	width: number,
	height: number,
	params: CaptionParams,
): void {
	drawOverlayText(canvas, width, height, params.text, params);
}

/** Everything drawCaptionToCanvas would put on screen, see overlayTextSignature. */
export function captionSignature(
	params: CaptionParams,
	width: number,
	height: number,
	fontsVersion: number,
): string {
	return overlayTextSignature(params.text, params, width, height, fontsVersion);
}
