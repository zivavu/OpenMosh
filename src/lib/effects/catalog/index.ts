import type { EffectShaderDef } from "../../gl/shader-lib";
import type { EffectDefinition } from "../types";
import * as pixelate from "./pixelate";
import * as posterize from "./posterize";
import * as solarize from "./solarize";
import * as edges from "./edges";
import * as neonEdges from "./neon-edges";
import * as bleach from "./bleach";
import * as sharpen from "./sharpen";
import * as mirror from "./mirror";
import * as kaleido from "./kaleido";
import * as channelSplit from "./channel-split";
import * as colorCorrection from "./color-correction";
import * as vignette from "./vignette";
import * as scanlines from "./scanlines";
import * as bulge from "./bulge";
import * as jitter from "./jitter";
import * as wobble from "./wobble";
import * as slices from "./slices";
import * as shake from "./shake";
import * as glow from "./glow";
import * as softGlitch from "./soft-glitch";
import * as opticalFlow from "./optical-flow";
import * as vhs from "./vhs";
import * as duotone from "./duotone";
import * as grain from "./grain";
import * as tile from "./tile";
import * as dataBend from "./data-bend";
import * as melt from "./melt";
import * as emboss from "./emboss";
import * as thermal from "./thermal";
import * as colorHalves from "./color-halves";
import * as stereoscopic from "./stereoscopic";
import * as pixelSort from "./pixel-sort";
import * as smear from "./smear";
import * as fiberDisplace from "./fiber-displace";
import * as relief from "./relief";
import * as zoom from "./zoom";
import * as tunnel from "./tunnel";
import * as audioBars from "./audio-bars";
import * as strobe from "./strobe";
import * as feedback from "./feedback";
import * as halftone from "./halftone";
import * as composite from "./composite";
import * as swirl from "./swirl";
import * as ripple from "./ripple";
import * as transform3d from "./transform-3d";
import * as blur from "./blur";
import * as radialBlur from "./radial-blur";
import * as liquidLight from "./liquid-light";
import * as petri from "./petri";
import * as flowContours from "./flow-contours";
import * as rgbBurst from "./rgb-burst";
import * as screenJump from "./screen-jump";
import * as sobelNeon from "./sobel-neon";
import * as hsvSwap from "./hsv-swap";
import * as rgbStrobe from "./rgb-strobe";
import * as trioTone from "./trio-tone";
import * as instaColor from "./insta-color";
import * as circleWarp from "./circle-warp";
import * as pixelShifter from "./pixel-shifter";
import * as ringWarp from "./ring-warp";
import * as shockwave from "./shockwave";
import * as ghosting from "./ghosting";
import * as fastMosh from "./fast-mosh";
import * as resizeGlitch from "./resize-glitch";
import * as stylizeGlitch from "./stylize-glitch";
import * as motionMask from "./motion-mask";
import * as tracking from "./tracking";
import * as caption from "./caption";
import * as mask from "./mask";

export interface CatalogEffect {
	definition: EffectDefinition;
	/** Absent for effects drawn outside the shader chain. */
	shader?: EffectShaderDef;
}

/** Every effect, one file each, in the order the effects panel lists them. */
export const CATALOG: CatalogEffect[] = [
	pixelate,
	posterize,
	solarize,
	edges,
	neonEdges,
	bleach,
	sharpen,
	mirror,
	kaleido,
	channelSplit,
	colorCorrection,
	vignette,
	scanlines,
	bulge,
	jitter,
	wobble,
	slices,
	shake,
	glow,
	softGlitch,
	opticalFlow,
	vhs,
	duotone,
	grain,
	tile,
	dataBend,
	melt,
	emboss,
	thermal,
	colorHalves,
	stereoscopic,
	pixelSort,
	smear,
	fiberDisplace,
	relief,
	zoom,
	tunnel,
	audioBars,
	strobe,
	feedback,
	halftone,
	composite,
	swirl,
	ripple,
	transform3d,
	blur,
	radialBlur,
	liquidLight,
	petri,
	flowContours,
	// Ports from the shader lab (lab/shaders): X-PostProcessing-Library and
	// Vidvox ISF-Files, both MIT. Randomness is quantised to ticks so preview and export match.
	rgbBurst,
	screenJump,
	sobelNeon,
	hsvSwap,
	rgbStrobe,
	trioTone,
	instaColor,
	circleWarp,
	pixelShifter,
	ringWarp,
	shockwave,
	ghosting,
	fastMosh,
	resizeGlitch,
	stylizeGlitch,
	motionMask,
	tracking,
	caption,
	// Last, so by default it covers everything above it.
	mask,
];
