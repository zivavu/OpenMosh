import { H, setFloat, setInt } from "../../gl/shader-lib";
import type { EffectShaderDef } from "../../gl/shader-lib";
import type { EffectDefinition, EffectInstance } from "../types";
import {
	MASK_KEYS_GLSL,
	MAX_COLOR_KEYS,
	keyUniforms,
	setKeyUniforms,
} from "../mask-keys";

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
] as const;

const placed = (v: Record<string, number | string>) =>
	v.shape === "ellipse" || v.shape === "rect" || v.shape === "gradient";
const sized = (v: Record<string, number | string>) =>
	v.shape === "ellipse" || v.shape === "rect";

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
				{ label: "Ellipse", value: "ellipse" },
				{ label: "Rectangle", value: "rect" },
				{ label: "Gradient", value: "gradient" },
				{ label: "Brightness", value: "brightness" },
				{ label: "Key", value: "key" },
				{ label: "Brush", value: "brush" },
			],
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
			visibleWhen: (v) => v.shape !== "brush" && v.shape !== "key",
		},
		{
			key: "amount",
			label: "Amount",
			type: "range",
			min: 0,
			max: 1,
			step: 0.01,
			defaultValue: 1,
		},
		{
			key: "invert",
			label: "Invert",
			type: "checkbox",
			defaultValue: 0,
		},
	],
};

export const shader: EffectShaderDef = {
	fragment:
		H +
		`uniform sampler2D u_original;
uniform sampler2D u_brush;
uniform vec2 u_resolution;
uniform float u_shape;
uniform float u_x;
uniform float u_y;
uniform float u_width;
uniform float u_height;
uniform float u_angle;
uniform float u_threshold;
uniform float u_feather;
uniform float u_amount;
uniform float u_invert;
uniform float u_preview;
${MASK_KEYS_GLSL}
// g = inside the touching keys' fill; coarse, so grown by a texel against a halo.
uniform sampler2D u_keyReach;

float reachAt(vec2 uv) {
  vec2 t = 1.0 / vec2(textureSize(u_keyReach, 0));
  float r = textureLod(u_keyReach, uv, 0.0).g;
  r = max(r, textureLod(u_keyReach, uv + vec2(t.x, t.y), 0.0).g);
  r = max(r, textureLod(u_keyReach, uv + vec2(-t.x, t.y), 0.0).g);
  r = max(r, textureLod(u_keyReach, uv + vec2(t.x, -t.y), 0.0).g);
  r = max(r, textureLod(u_keyReach, uv + vec2(-t.x, -t.y), 0.0).g);
  return r;
}

float coverage(vec2 uv, vec4 base) {
  if (u_shape > 4.5) {
    vec3 lab = oklab(base.rgb);
    float m = 0.0;
    float reach = -1.0;
    for (int i = 0; i < ${MAX_COLOR_KEYS}; i++) {
      if (float(i) >= u_keyCount) break;
      vec2 t = u_keyTune[i];
      float k = 1.0 - smoothstep(t.x, t.x + t.y, distance(lab, u_keyLab[i]));
      if (u_keyTouch[i] > 0.5) {
        if (reach < 0.0) reach = reachAt(uv);
        k *= reach;
      }
      m = max(m, k);
    }
    return m;
  }
  if (u_shape > 3.5) return texture(u_brush, uv).r;
  if (u_shape > 2.5) {
    float l = dot(base.rgb, vec3(0.2126, 0.7152, 0.0722));
    float f = max(u_feather * 0.5, 0.002);
    return smoothstep(u_threshold - f, u_threshold + f, l);
  }
  // Short-edge units, so equal width and height make a circle.
  vec2 p = (uv - vec2(u_x, u_y)) * u_resolution / min(u_resolution.x, u_resolution.y);
  float a = radians(u_angle);
  p = mat2(cos(a), sin(a), -sin(a), cos(a)) * p;
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
  float m = clamp(coverage(v_uv, base), 0.0, 1.0);
  if (u_invert > 0.5) m = 1.0 - m;
  outColor = mix(base, cur, m * u_amount);
  if (u_preview > 0.5) {
    // Outside tinted, edge traced, so the area reads whatever the effects do.
    outColor.rgb = mix(outColor.rgb, vec3(1.0, 0.18, 0.45), (1.0 - m) * 0.5);
    float edge = 1.0 - smoothstep(0.0, max(fwidth(m), 0.0001) * 1.5, abs(m - 0.5));
    outColor.rgb = mix(outColor.rgb, vec3(1.0), edge * 0.85);
    outColor.a = max(outColor.a, (1.0 - m) * 0.5);
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
			"amount",
			"invert",
		]) {
			setFloat(gl, l, `u_${key}`, v[key] as number);
		}
		setInt(gl, l, "u_brush", MASK_BRUSH_UNIT);
		setFloat(gl, l, "u_preview", (v.preview as number | undefined) ?? 0);
		setKeyUniforms(gl, l, keyUniforms(String(v.keys ?? "")));
		setInt(gl, l, "u_keyReach", MASK_REACH_UNIT);
	},
};
