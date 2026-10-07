import { DEFAULT_AUDIO_RESPONSE, punchExponent } from "../../audio/auto-range";
import { H, setColor, setFloat, setInt } from "../../gl/shader-lib";
import type { EffectShaderDef } from "../../gl/shader-lib";
import type { EffectDefinition } from "../types";

export const definition: EffectDefinition = {
	id: "audio-bars",
	name: "Audio Bars",
	needsAudio: true,
	moshable: false,
	params: [
		{
			key: "bars",
			label: "Bars",
			type: "range",
			min: 8,
			max: 128,
			step: 1,
			defaultValue: 48,
		},
		{
			key: "height",
			label: "Height",
			type: "range",
			min: 0,
			max: 1,
			step: 0.01,
			defaultValue: 0.4,
		},
		{
			key: "gain",
			label: "Gain",
			type: "range",
			min: 0.1,
			max: 3,
			step: 0.05,
			// 1.0 now that bins arrive normalized; above it just clips peaks
			// against the top of the bar.
			defaultValue: 1,
		},
		{
			// Both default to DEFAULT_AUDIO_RESPONSE, so bars follow the music
			// like a volume link.
			key: "smoothing",
			label: "Smoothing",
			type: "range",
			min: 0,
			max: 1,
			step: 0.01,
			defaultValue: 0.45,
		},
		{
			key: "punch",
			label: "Punch",
			type: "range",
			min: 0,
			max: 1,
			step: 0.01,
			defaultValue: 0.4,
		},
		{
			key: "peaks",
			label: "Peaks",
			type: "checkbox",
			defaultValue: 1,
		},
		{
			key: "opacity",
			label: "Opacity",
			type: "range",
			min: 0,
			max: 1,
			step: 0.01,
			defaultValue: 0.9,
		},
		{
			key: "anchor",
			label: "Anchor",
			type: "select",
			defaultValue: "bottom",
			options: [
				{ label: "Bottom", value: "bottom" },
				{ label: "Top", value: "top" },
				{ label: "Center", value: "center" },
			],
		},
		{
			key: "style",
			label: "Style",
			type: "select",
			defaultValue: "solid",
			options: [
				{ label: "Solid", value: "solid" },
				{ label: "Segmented", value: "segmented" },
			],
		},
		{
			key: "color",
			label: "Color",
			type: "color",
			defaultValue: "#4dffb8",
		},
	],
};

export const shader: EffectShaderDef = {
	fragment:
		H +
		`uniform sampler2D u_spectrum;
uniform float u_bars;
uniform float u_height;
uniform float u_gain;
uniform float u_punch;
uniform float u_opacity;
uniform int u_anchor;
uniform int u_style;
uniform int u_peaks;
uniform vec3 u_color;

// Punch reshapes the response as for volume links: below 1 lifts quiet detail
// into movement, above 1 leaves only the hits.
float shape(float v) {
  return clamp(pow(v, u_punch) * u_gain, 0.0, 1.0) * u_height;
}

void main() {
  vec4 src = texture(u_texture, v_uv);
  float bars = max(floor(u_bars), 1.0);
  float slot = v_uv.x * bars;
  // One texel per bar: its level, then its falling cap.
  int last = textureSize(u_spectrum, 0).x - 1;
  vec2 bar = texelFetch(u_spectrum, ivec2(min(int(slot), last), 0), 0).rg;
  float level = shape(bar.r);
  float peak = shape(bar.g);

  // v_uv.y runs top-down, so anchoring to the bottom means measuring back up.
  float d = u_anchor == 1 ? v_uv.y
          : u_anchor == 2 ? abs(v_uv.y - 0.5) * 2.0
          : 1.0 - v_uv.y;

  float within = fract(slot);
  float gap = smoothstep(0.0, 0.10, within) * (1.0 - smoothstep(0.90, 1.0, within));
  float fill = (1.0 - smoothstep(level - 0.004, level + 0.004, d)) * gap;
  if (u_style == 1) {
    float seg = fract(d * 26.0);
    fill *= 1.0 - smoothstep(0.55, 0.75, seg);
  }

  // Hot tips: a flat colour column reads as a dead bar chart.
  float tip = 1.0 + 0.8 * (1.0 - smoothstep(0.0, 0.12, max(level - d, 0.0)));
  vec3 col = clamp(u_color * tip, 0.0, 1.0);

  if (u_peaks == 1 && peak > 0.01) {
    float cap = smoothstep(peak - 0.014, peak - 0.010, d) * (1.0 - smoothstep(peak - 0.002, peak + 0.002, d)) * gap;
    col = mix(col, mix(u_color, vec3(1.0), 0.6), cap);
    fill = max(fill, cap);
  }
  outColor = vec4(mix(src.rgb, col, clamp(fill, 0.0, 1.0) * u_opacity), src.a);
}`,
	animated: true,
	setUniforms: (gl, l, v) => {
		setFloat(gl, l, "u_bars", v.bars as number);
		setFloat(gl, l, "u_height", v.height as number);
		setFloat(gl, l, "u_gain", v.gain as number);
		// Smoothing is applied on the CPU per instance before upload; only the punch
		// curve is left to the shader.
		setFloat(
			gl,
			l,
			"u_punch",
			punchExponent(
				typeof v.punch === "number" ? v.punch : DEFAULT_AUDIO_RESPONSE.punch,
			),
		);
		setFloat(gl, l, "u_opacity", v.opacity as number);
		setInt(
			gl,
			l,
			"u_anchor",
			v.anchor === "top" ? 1 : v.anchor === "center" ? 2 : 0,
		);
		setInt(gl, l, "u_style", v.style === "segmented" ? 1 : 0);
		setInt(gl, l, "u_peaks", v.peaks === 0 ? 0 : 1);
		setColor(gl, l, "u_color", v.color as string);
	},
};
