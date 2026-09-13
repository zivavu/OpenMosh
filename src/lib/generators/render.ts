import { renderGradientBlob } from "./gradient/render";
import type { GeneratedSpec } from "./types";

/** Render any spec to an encoded blob at the given size. */
export function renderSpec(
	spec: GeneratedSpec,
	width: number,
	height: number,
	type: "image/png" | "image/jpeg" = "image/png",
): Promise<Blob> {
	return renderGradientBlob(spec, width, height, type);
}
