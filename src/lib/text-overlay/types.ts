/** How to composite a text layer onto the image beneath it. */
export type TextOverlayBlendMode =
	| "normal"
	| "multiply"
	| "add"
	| "screen"
	| "overlay"
	| "difference"
	| "exclusion"
	| "subtract";

/** Every blend mode, in the order the pickers list them. */
export const BLEND_MODES: readonly TextOverlayBlendMode[] = [
	"normal",
	"multiply",
	"screen",
	"overlay",
	"add",
	"subtract",
	"difference",
	"exclusion",
];
