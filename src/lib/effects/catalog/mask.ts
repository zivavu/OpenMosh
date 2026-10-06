import { H, setFloat, setInt } from "../../gl/shader-lib";
import type { EffectShaderDef } from "../../gl/shader-lib";
import type { EffectDefinition, EffectInstance } from "../types";
import { KEYS_MATCH_GLSL, setKeyUniforms } from "../../color-key";
import { keyUniforms } from "../mask-keys";

export const MASK_EFFECT_ID = "mask";
/** Texture unit the renderer binds the painted mask to. */
export const MASK_BRUSH_UNIT = 6;
/** And the Key shape's touching fill. */
export const MASK_REACH_UNIT = 7;

const SHAPES = [
	"ellipse",
	"rect",
	"gradient",
	"brightness",
	"brush",
	"key",
	"image",
] as const;

const placed = (v: Record<string, number | string>) =>
	v.shape === "ellipse" ||
	v.shape === "rect" ||
	v.shape === "gradient" ||
	imageLoaded(v);
const sized = (v: Record<string, number | string>) =>
	v.shape === "ellipse" || v.shape === "rect";
const isImage = (v: Record<string, number | string>) => v.shape === "image";
const imageLoaded = (v: Record<string, number | string>) =>
	isImage(v) && !!v.image;

/** The Image shape before anything is loaded: it masks nothing, and only Load means
 * anything yet. */
export function maskAwaitingImage(v: Record<string, number | string>): boolean {
	return isImage(v) && !v.image;
}

export function isMaskEffect(e: Pick<EffectInstance, "defId">): boolean {
	return e.defId === MASK_EFFECT_ID;
}

/** Keeps the effects above it, back to the previous Mask, inside its shape, and
 * puts back what was there before them everywhere else. */
export const definition: EffectDefinition = {
	id: MASK_EFFECT_ID,
	name: "Mask",
	hint: "Limits the effects above it, back to the previous Mask, to this shape. Everywhere else shows the picture without them.",
	moshable: false,
	params: [
		{
			key: "shape",
			label: "Shape",
			type: "select",
			defaultValue: "ellipse",
			options: [
				{ label: "Brush", value: "brush" },
				{ label: "Key", value: "key" },
				{ label: "Image", value: "image" },
				{ label: "Brightness", value: "brightness" },
				{ label: "Ellipse", value: "ellipse" },
				{ label: "Rectangle", value: "rect" },
				{ label: "Gradient", value: "gradient" },
			],
		},
		{
			key: "image",
			label: "Image",
			type: "image",
			defaultValue: "",
			visibleWhen: isImage,
		},
		{
			key: "channel",
			label: "Read by",
			type: "select",
			defaultValue: "luma",
			options: [
				{ label: "Brightness", value: "luma" },
				{ label: "Transparency", value: "alpha" },
			],
			visibleWhen: imageLoaded,
		},
		{
			key: "fit",
			label: "Fit",
			type: "select",
			defaultValue: "contain",
			options: [
				{ label: "Stretch", value: "stretch" },
				{ label: "Fit", value: "contain" },
				{ label: "Fill", value: "cover" },
			],
			visibleWhen: imageLoaded,
		},
		{
			key: "imageWidth",
			label: "Width",
			type: "range",
			min: 0.05,
			max: 4,
			step: 0.01,
			defaultValue: 1,
			visibleWhen: imageLoaded,
		},
		{
			key: "imageHeight",
			label: "Height",
			type: "range",
			min: 0.05,
			max: 4,
			step: 0.01,
			defaultValue: 1,
			visibleWhen: imageLoaded,
		},
		{
			key: "black",
			label: "Black point",
			type: "range",
			min: 0,
			max: 1,
			step: 0.01,
			defaultValue: 0,
			visibleWhen: imageLoaded,
		},
		{
			key: "white",
			label: "White point",
			type: "range",
			min: 0,
			max: 1,
			step: 0.01,
			defaultValue: 1,
			visibleWhen: imageLoaded,
		},
		{
			key: "keys",
			label: "Colors",
			type: "keys",
			defaultValue: "",
			visibleWhen: (v) => v.shape === "key",
		},
		{
			key: "paint",
			label: "Paint",
			type: "paint",
			defaultValue: "",
			visibleWhen: (v) => v.shape === "brush",
		},
		{
			key: "x",
			label: "X",
			type: "range",
			min: 0,
			max: 1,
			step: 0.01,
			defaultValue: 0.5,
			visibleWhen: placed,
		},
		{
			key: "y",
			label: "Y",
			type: "range",
			min: 0,
			max: 1,
			step: 0.01,
			defaultValue: 0.5,
			visibleWhen: placed,
		},
		{
			key: "width",
			label: "Width",
			type: "range",
			min: 0,
			max: 2,
			step: 0.01,
			defaultValue: 0.6,
			visibleWhen: sized,
		},
		{
			key: "height",
			label: "Height",
			type: "range",
			min: 0,
			max: 2,
			step: 0.01,
			defaultValue: 0.6,
			visibleWhen: sized,
		},
		{
			key: "angle",
			label: "Angle",
			type: "range",
			min: -180,
			max: 180,
			step: 1,
			defaultValue: 0,
			visibleWhen: placed,
		},
		{
			key: "threshold",
			label: "Threshold",
			type: "range",
			min: 0,
			max: 1,
			step: 0.01,
			defaultValue: 0.5,
			visibleWhen: (v) => v.shape === "brightness",
		},
		{
			key: "feather",
			label: "Feather",
			type: "range",
			min: 0,
			max: 1,
			step: 0.01,
			defaultValue: 0.2,
			visibleWhen: (v) =>
				v.shape !== "brush" && v.shape !== "key" && v.shape !== "image",
		},
		{
			// Its own param: Feather's 0.2 default sits in every saved brush Mask.
			key: "paintFeather",
			label: "Feather",
			type: "range",
			min: 0,
			max: 1,
			step: 0.01,
			defaultValue: 0,
			visibleWhen: (v) => v.shape === "brush",
		},
		{
			key: "amount",
			label: "Amount",
			type: "range",
			min: 0,
			max: 1,
			step: 0.01,
			defaultValue: 1,
			visibleWhen: (v) => !maskAwaitingImage(v),
		},
		{
			key: "invert",
			label: "Invert",
			type: "checkbox",
			defaultValue: 0,
			visibleWhen: (v) => !maskAwaitingImage(v),
		},
	],
};

export const shader: EffectShaderDef = {
	fragment:
		H +
		`uniform sampler2D u_original;
uniform sampler2D u_brush;
uniform float u_chainAspect;
uniform float u_shape;
uniform float u_x;
uniform float u_y;
uniform float u_width;
uniform float u_height;
uniform float u_angle;
uniform float u_threshold;
uniform float u_feather;
uniform float u_paintFeather;
uniform float u_amount;
uniform float u_invert;
uniform float u_preview;
// The Key colour the preview tints alone; -1 for all of them.
uniform float u_previewKey;
uniform float u_channel;
uniform float u_fit;
uniform float u_black;
uniform float u_white;
uniform float u_hasImage;
uniform float u_imageWidth;
uniform float u_imageHeight;
${KEYS_MATCH_GLSL}
// g = inside the touching keys' fill; coarse, so grown by a texel against a halo.
uniform sampler2D u_keyReach;

float keyReach(vec2 uv) {
  vec2 t = 1.0 / vec2(textureSize(u_keyReach, 0));
  float r = textureLod(u_keyReach, uv, 0.0).g;
  r = max(r, textureLod(u_keyReach, uv + vec2(t.x, t.y), 0.0).g);
  r = max(r, textureLod(u_keyReach, uv + vec2(-t.x, t.y), 0.0).g);
  r = max(r, textureLod(u_keyReach, uv + vec2(t.x, -t.y), 0.0).g);
  r = max(r, textureLod(u_keyReach, uv + vec2(-t.x, -t.y), 0.0).g);
  return r;
}

// Units of the short edge of what the chain lands on, so equal sides are a circle
// on screen even over a media layer's stretched box.
vec2 shortEdge() {
  return max(vec2(u_chainAspect, 1.0) / min(u_chainAspect, 1.0), vec2(1.0));
}

// Where the loaded image sits under uv: stretched, fitted inside, or filling.
// Outside a fitted image is outside the mask.
float imageCoverage(vec2 uv) {
  vec2 ts = vec2(textureSize(u_brush, 0));
  float r = (ts.x / ts.y) / u_chainAspect;
  vec2 size = vec2(1.0);
  if (u_fit > 1.5) size = r > 1.0 ? vec2(r, 1.0) : vec2(1.0, 1.0 / r);
  else if (u_fit > 0.5) size = r > 1.0 ? vec2(1.0, 1.0 / r) : vec2(r, 1.0);
  // Placed like the other shapes: in short-edge units, turned about its centre.
  vec2 s = shortEdge();
  vec2 box = size * s * vec2(u_imageWidth, u_imageHeight);
  vec2 p = (uv - vec2(u_x, u_y)) * s;
  float a = radians(u_angle);
  p = mat2(cos(a), -sin(a), sin(a), cos(a)) * p;
  vec2 iu = p / box + 0.5;
  if (any(lessThan(iu, vec2(0.0))) || any(greaterThan(iu, vec2(1.0)))) return 0.0;
  vec4 t = texture(u_brush, iu);
  float v = u_channel > 0.5 ? t.a : t.r;
  return clamp((v - u_black) / max(u_white - u_black, 0.001), 0.0, 1.0);
}

// The painting, blurred by the brush's Feather: a spiral of taps from a mip level about
// as coarse as their spacing, so a wide feather stays smooth.
float paintCoverage(vec2 uv) {
  if (u_paintFeather <= 0.0) return texture(u_brush, uv).r;
  vec2 rad = u_paintFeather * 0.15 / shortEdge();
  vec2 ts = vec2(textureSize(u_brush, 0));
  float lod = max(0.0, log2(max(rad.x * ts.x, rad.y * ts.y) / 4.0));
  float sum = 0.0;
  float wsum = 0.0;
  for (int i = 0; i < 24; i++) {
    float r = sqrt((float(i) + 0.5) / 24.0);
    float a = float(i) * 2.39996;
    float w = exp(-2.0 * r * r);
    sum += textureLod(u_brush, uv + vec2(cos(a), sin(a)) * r * rad, lod).r * w;
    wsum += w;
  }
  return sum / wsum;
}

float coverage(vec2 uv, vec4 base) {
  if (u_shape > 5.5) return imageCoverage(uv);
  if (u_shape > 4.5) return keysMatch(oklab(base.rgb), uv, -1.0);
  if (u_shape > 3.5) return paintCoverage(uv);
  if (u_shape > 2.5) {
    float l = dot(base.rgb, vec3(0.2126, 0.7152, 0.0722));
    float f = max(u_feather * 0.5, 0.002);
    return smoothstep(u_threshold - f, u_threshold + f, l);
  }
  vec2 p = (uv - vec2(u_x, u_y)) * shortEdge();
  // Clockwise for a positive angle, the way layers turn.
  float a = radians(u_angle);
  p = mat2(cos(a), -sin(a), sin(a), cos(a)) * p;
  if (u_shape > 1.5) {
    float f = max(u_feather * 0.5, 0.001);
    return smoothstep(-f, f, -p.y);
  }
  vec2 q = abs(p) / max(vec2(u_width, u_height) * 0.5, vec2(0.0001));
  float r = u_shape > 0.5 ? max(q.x, q.y) : length(q);
  float soft = max(u_feather, fwidth(r));
  return 1.0 - smoothstep(1.0 - soft, 1.0, r);
}

void main() {
  vec4 cur = texture(u_texture, v_uv);
  vec4 base = texture(u_original, v_uv);
  // An Image shape with nothing loaded leaves the effects alone.
  if (u_shape > 5.5 && u_hasImage < 0.5) {
    outColor = cur;
    return;
  }
  float m = clamp(coverage(v_uv, base), 0.0, 1.0);
  if (u_invert > 0.5) m = 1.0 - m;
  outColor = mix(base, cur, m * u_amount);
  if (u_preview > 0.0) {
    // A focused Key colour shows only what it selects, invert aside.
    float shown = m;
    if (u_shape > 4.5 && u_shape < 5.5 && u_previewKey >= 0.0) {
      shown = keysMatch(oklab(base.rgb), v_uv, u_previewKey);
    }
    // Outside tinted, edge traced, so the area reads whatever the effects do. Scaled
    // by u_preview, which the preview eases in and out.
    float tint = (1.0 - shown) * 0.5 * u_preview;
    outColor.rgb = mix(outColor.rgb, vec3(1.0, 0.18, 0.45), tint);
    float edge = 1.0 - smoothstep(0.0, max(fwidth(shown), 0.0001) * 1.5, abs(shown - 0.5));
    outColor.rgb = mix(outColor.rgb, vec3(1.0), edge * 0.85 * u_preview);
    outColor.a = max(outColor.a, tint);
  }
}`,
	setUniforms: (gl, l, v) => {
		setFloat(gl, l, "u_shape", Math.max(0, SHAPES.indexOf(v.shape as never)));
		for (const key of [
			"x",
			"y",
			"width",
			"height",
			"angle",
			"threshold",
			"feather",
			"paintFeather",
			"amount",
			"invert",
			"black",
			"white",
			"imageWidth",
			"imageHeight",
		]) {
			setFloat(gl, l, `u_${key}`, v[key] as number);
		}
		setFloat(gl, l, "u_channel", v.channel === "alpha" ? 1 : 0);
		setFloat(gl, l, "u_hasImage", v.image ? 1 : 0);
		setFloat(
			gl,
			l,
			"u_fit",
			["stretch", "contain", "cover"].indexOf(String(v.fit)),
		);
		setInt(gl, l, "u_brush", MASK_BRUSH_UNIT);
		setFloat(gl, l, "u_preview", (v.preview as number | undefined) ?? 0);
		setFloat(gl, l, "u_previewKey", (v.previewKey as number | undefined) ?? -1);
		setKeyUniforms(gl, l, keyUniforms(String(v.keys ?? "")));
		setInt(gl, l, "u_keyReach", MASK_REACH_UNIT);
	},
};
