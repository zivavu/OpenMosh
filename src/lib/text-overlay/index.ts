export type { TextOverlayBlendMode } from "./types";
export { drawOverlayText, overlayTextBox, overlayTextSignature } from "./draw";
export type { CanvasTextStyle, OverlayTextBox } from "./draw";
export { FONT_OPTIONS, ensureFontLoaded } from "./fonts";
export type { FontOption } from "./fonts";
export { fontsVersion, onFontsChanged } from "./font-registry";
export {
  addCustomFont,
  addCustomFontFile,
  customFonts,
  loadCustomFonts,
  removeCustomFont,
} from "./custom-fonts.svelte";
export type { CustomFont } from "./custom-fonts.svelte";
