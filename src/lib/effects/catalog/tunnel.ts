import { H, floats } from "../../gl/shader-lib";
import type { EffectShaderDef } from "../../gl/shader-lib";
import type { EffectDefinition } from "../types";

export const definition: EffectDefinition = {
	id: "tunnel",
	name: "Tunnel",
	params: [
		{
			key: "zoom",
			label: "Zoom",
			type: "range",
			min: 0,
			max: 1,
			step: 0.01,
			defaultValue: 0.3,
		},
		{
			key: "spin",
			label: "Spin",
			type: "range",
			min: -180,
			max: 180,
			step: 1,
			defaultValue: 0,
		},
		{
			key: "decay",
			label: "Decay",
			type: "range",
			min: 0,
			max: 1,
			step: 0.01,
			defaultValue: 0.2,
		},
	],
};

export const shader: EffectShaderDef = {
	fragment:
		H +
		`uniform float u_zoom;
uniform float u_spin;
uniform float u_decay;
uniform float u_delta;
uniform sampler2D u_feedback;
void main() {
  // Pull last frame slightly toward/around the center: infinite zoom tunnel.
  // Out-of-bounds samples mirror (texture wrap), folding the edges back in.
  float s = 1.0 - u_zoom * u_delta * 0.8;
  float a = u_spin * (3.14159265 / 180.0) * u_delta;
  vec2 c = v_uv - 0.5;
  float ca = cos(a), sa = sin(a);
  c = vec2(ca * c.x - sa * c.y, sa * c.x + ca * c.y) * s;
  // Decay knob is inverted (higher = fades faster) and cropped to the
  // usable 0.90 to 1.00 per-frame multiplier range.
  float fade = 1.0 - u_decay * 0.1;
  vec4 prev = texture(u_feedback, c + 0.5) * pow(fade, u_delta * 60.0);
  vec4 fresh = texture(u_texture, v_uv);
  outColor = vec4(clamp(max(fresh.rgb, prev.rgb), 0.0, 1.0),
                  clamp(max(fresh.a, prev.a), 0.0, 1.0));
}`,
	animated: true,
	setUniforms: floats("zoom", "spin", "decay"),
};
