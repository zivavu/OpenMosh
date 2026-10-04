import { BOUNCE_GLSL, H, setFloat, setInt } from "../../gl/shader-lib";
import type { EffectShaderDef } from "../../gl/shader-lib";
import type { EffectDefinition } from "../types";

export const definition: EffectDefinition = {
	id: "transform-3d",
	name: "3D Transform",
	// Curated rolls leave it out: it only fits when picked on purpose.
	moshable: false,
	// u_time arrives as degrees turned so far.
	rateParam: "spin",
	params: [
		{
			key: "rotX",
			label: "Rotate X",
			type: "range",
			min: -180,
			max: 180,
			step: 1,
			defaultValue: 0,
			// Past ~60 degrees the plane is edge-on and the frame is mostly
			// horizon, so a roll stays inside it.
			moshMin: -55,
			moshMax: 55,
		},
		{
			key: "rotY",
			label: "Rotate Y",
			type: "range",
			min: -180,
			max: 180,
			step: 1,
			defaultValue: 25,
			moshMin: -55,
			moshMax: 55,
		},
		{
			key: "rotZ",
			label: "Rotate Z",
			type: "range",
			min: -180,
			max: 180,
			step: 1,
			defaultValue: 0,
		},
		{
			key: "perspective",
			label: "Perspective",
			type: "range",
			min: 0,
			max: 1,
			step: 0.01,
			defaultValue: 0.5,
		},
		{
			key: "zoom",
			label: "Zoom",
			type: "range",
			min: 0.2,
			max: 3,
			step: 0.01,
			defaultValue: 1,
			moshMin: 0.6,
			moshMax: 1.6,
		},
		{
			key: "spin",
			label: "Spin",
			type: "range",
			min: 0,
			max: 180,
			step: 1,
			defaultValue: 0,
			moshMax: 70,
		},
		{
			key: "axis",
			label: "Spin Axis",
			type: "select",
			defaultValue: "y",
			options: [
				{ label: "X", value: "x" },
				{ label: "Y", value: "y" },
				{ label: "Z", value: "z" },
				{ label: "Tumble", value: "tumble" },
			],
			visibleWhen: (v) => (v.spin as number) > 0,
		},
		{
			key: "edge",
			label: "Edges",
			type: "select",
			defaultValue: "none",
			options: [
				{ label: "Transparent", value: "none" },
				{ label: "Clamp", value: "clamp" },
				{ label: "Tile", value: "tile" },
				{ label: "Mirror", value: "mirror" },
			],
		},
	],
};

export const shader: EffectShaderDef = {
	fragment:
		H +
		BOUNCE_GLSL +
		`uniform float u_rotX;
uniform float u_rotY;
uniform float u_rotZ;
uniform float u_perspective;
uniform float u_zoom;
uniform int u_axis;
uniform int u_edge;

const float DEG = 0.017453292;

mat3 rotateX(float a) { float c = cos(a), s = sin(a);
  return mat3(1.0, 0.0, 0.0, 0.0, c, s, 0.0, -s, c); }
mat3 rotateY(float a) { float c = cos(a), s = sin(a);
  return mat3(c, 0.0, -s, 0.0, 1.0, 0.0, s, 0.0, c); }
mat3 rotateZ(float a) { float c = cos(a), s = sin(a);
  return mat3(c, s, 0.0, -s, c, 0.0, 0.0, 0.0, 1.0); }

void main() {
  vec2 res = vec2(textureSize(u_texture, 0));
  float aspect = res.x / res.y;

  float t = u_time * DEG;
  float sx = u_axis == 0 ? t : (u_axis == 3 ? t * 0.43 : 0.0);
  float sy = u_axis == 1 ? t : (u_axis == 3 ? t : 0.0);
  float sz = u_axis == 2 ? t : (u_axis == 3 ? t * 0.17 : 0.0);
  mat3 R = rotateZ(u_rotZ * DEG + sz) * rotateY(u_rotY * DEG + sy)
         * rotateX(u_rotX * DEG + sx);

  // Focal length: the low end is nearly orthographic, the high end a wide lens.
  // The plane sits at exactly f, so an untilted quad fills the frame either way.
  float f = mix(8.0, 0.9, u_perspective);
  vec3 center = vec3(0.0, 0.0, f / max(u_zoom, 0.001));

  // Inverse mapping: shoot a ray per output pixel and intersect the rotated plane,
  // rather than rasterizing a quad. Zero rotation is a passthrough.
  vec3 dir = vec3((v_uv - 0.5) * 2.0 * vec2(aspect, 1.0), f);
  vec3 n = R * vec3(0.0, 0.0, 1.0);
  float denom = dot(n, dir);
  float k = dot(n, center) / denom;
  vec3 q = transpose(R) * (k * dir - center);
  vec2 uv = vec2(q.x / aspect, q.y) * 0.5 + 0.5;
  // Taken before the horizon test: a derivative is only defined when the whole quad
  // reaches it, and half may be about to bail out.
  vec2 w = clamp(fwidth(uv), vec2(1e-4), vec2(0.1));
  // Edge-on, or the intersection is behind the camera: past the horizon.
  if (abs(denom) < 1e-5 || k <= 0.0) { outColor = vec4(0.0); return; }

  if (u_edge == 1) {
    outColor = texture(u_texture, clamp(uv, 0.0, 1.0));
  } else if (u_edge == 2) {
    outColor = texture(u_texture, fract(uv));
  } else if (u_edge == 3) {
    outColor = texture(u_texture, vec2(bounce(uv.x), bounce(uv.y)));
  } else {
    // Feather by one pixel of the *warped* uv so the receding edge doesn't stair-step.
    vec2 e = smoothstep(vec2(0.0), w, uv) * smoothstep(vec2(0.0), w, 1.0 - uv);
    float cov = e.x * e.y;
    if (cov <= 0.0) { outColor = vec4(0.0); return; }
    vec4 c = texture(u_texture, clamp(uv, 0.0, 1.0));
    outColor = vec4(c.rgb, c.a * cov);
  }
}`,
	animated: true,
	linearFilter: true,
	setUniforms: (gl, l, v) => {
		setFloat(gl, l, "u_rotX", v.rotX as number);
		setFloat(gl, l, "u_rotY", v.rotY as number);
		setFloat(gl, l, "u_rotZ", v.rotZ as number);
		setFloat(gl, l, "u_perspective", v.perspective as number);
		setFloat(gl, l, "u_zoom", v.zoom as number);
		setInt(
			gl,
			l,
			"u_axis",
			v.axis === "x" ? 0 : v.axis === "z" ? 2 : v.axis === "tumble" ? 3 : 1,
		);
		setInt(
			gl,
			l,
			"u_edge",
			v.edge === "clamp"
				? 1
				: v.edge === "tile"
					? 2
					: v.edge === "mirror"
						? 3
						: 0,
		);
	},
};
