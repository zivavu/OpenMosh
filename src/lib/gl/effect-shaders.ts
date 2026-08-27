import { hexToVec3 } from '../color';
import { DEFAULT_AUDIO_RESPONSE, punchExponent } from '../audio/auto-range';

export const VERTEX_SHADER = `#version 300 es
layout(location = 0) in vec2 a_position;
out vec2 v_uv;
uniform float u_flipY;
void main() {
  gl_Position = vec4(a_position.x, a_position.y * u_flipY, 0.0, 1.0);
  v_uv = a_position * 0.5 + 0.5;
}`;

const H = `#version 300 es
precision highp float;
uniform sampler2D u_texture;
uniform float u_time;
in vec2 v_uv;
out vec4 outColor;
`;

const BOUNCE_GLSL = `float bounce(float v) {
  v = mod(abs(v), 2.0);
  return v > 1.0 ? 2.0 - v : v;
}
`;

const HASH_GLSL = `float hash(vec2 p) {
  return fract(sin(dot(p, vec2(12.9898, 78.233))) * 43758.5453);
}
`;

const NOISE_GLSL =
	HASH_GLSL +
	`float vnoise(vec2 p) {
  vec2 i = floor(p);
  vec2 f = fract(p);
  vec2 u = f * f * (3.0 - 2.0 * f);
  return mix(mix(hash(i), hash(i + vec2(1.0, 0.0)), u.x),
             mix(hash(i + vec2(0.0, 1.0)), hash(i + vec2(1.0, 1.0)), u.x), u.y);
}
float fbm(vec2 p) {
  return vnoise(p) * 0.55 + vnoise(p * 2.13 + 5.0) * 0.3
       + vnoise(p * 4.41 + 9.0) * 0.15;
}
`;

/** Hue/sat/value conversion, shared by the effects that reason in HSV. */
const HSV_GLSL = `vec3 rgb2hsv(vec3 c) {
  vec4 K = vec4(0.0, -1.0/3.0, 2.0/3.0, -1.0);
  vec4 p = mix(vec4(c.bg, K.wz), vec4(c.gb, K.xy), step(c.b, c.g));
  vec4 q = mix(vec4(p.xyw, c.r), vec4(c.r, p.yzx), step(p.x, c.r));
  float d = q.x - min(q.w, q.y);
  return vec3(abs(q.z + (q.w - q.y) / (6.0*d + 1e-10)), d / (q.x + 1e-10), q.x);
}

vec3 hsv2rgb(vec3 c) {
  vec4 K = vec4(1.0, 2.0/3.0, 1.0/3.0, 3.0);
  vec3 p = abs(fract(c.xxx + K.xyz) * 6.0 - K.www);
  return c.z * mix(K.xxx, clamp(p - K.xxx, 0.0, 1.0), c.y);
}
`;

const HUE_ROTATE_GLSL = `vec3 hueRotate(vec3 c, float angle) {
  float rad = angle * 3.14159265 / 180.0;
  float cosA = cos(rad);
  float sinA = sin(rad);
  vec3 k = vec3(0.57735026919);
  return c * cosA + cross(k, c) * sinA + k * dot(k, c) * (1.0 - cosA);
}
`;

export const PASSTHROUGH_FRAG =
	H +
	`void main() {
  outColor = texture(u_texture, v_uv);
}`;

/** Shared by the placement pass and the composite, so the box they agree on is one copy. */
const LAYER_BOX_GLSL = `uniform vec2 u_frameSize;
uniform vec2 u_drawSize;
uniform vec2 u_center;
uniform float u_rot;

/** Frame uv -> uv inside the placed media. Outside [0,1] is off the layer. */
vec2 layerUv(vec2 uv) {
  vec2 p = (uv - u_center) * u_frameSize;
  float s = sin(u_rot);
  float c = cos(u_rot);
  vec2 r = vec2(c * p.x + s * p.y, c * p.y - s * p.x);
  return r / max(u_drawSize, vec2(1.0)) + 0.5;
}

float insideLayer(vec2 uv) {
  vec2 e = step(vec2(0.0), uv) * step(uv, vec2(1.0));
  return e.x * e.y;
}
`;

/**
 * Place a media layer into a full-frame buffer: fitted, scaled, rotated and
 * centred, with everything outside its box transparent so the composite leaves
 * the image underneath it alone.
 */
export const LAYER_TRANSFORM_FRAG = `#version 300 es
precision highp float;
uniform sampler2D u_texture;
uniform vec3 u_keyColor;
// <= 0 switches the key off, so an unkeyed layer costs one compare.
uniform float u_keyThreshold;
uniform float u_keySmooth;
in vec2 v_uv;
out vec4 outColor;
${LAYER_BOX_GLSL}
// Chroma distance, not RGB: keying on hue alone keeps shadows and highlights
// on the subject while still cutting a lit-unevenly backdrop.
vec2 chroma(vec3 c) {
  return vec2(dot(c, vec3(-0.169, -0.331, 0.5)), dot(c, vec3(0.5, -0.419, -0.081)));
}
void main() {
  vec2 uv = layerUv(v_uv);
  vec4 c = texture(u_texture, clamp(uv, 0.0, 1.0));
  if (u_keyThreshold > 0.0) {
    float d = distance(chroma(c.rgb), chroma(u_keyColor));
    c.a *= smoothstep(u_keyThreshold, u_keyThreshold + max(u_keySmooth, 0.0001), d);
  }
  outColor = c * insideLayer(uv);
}`;

/** Blend text overlay over main image. u_blendMode: 0=normal,1=multiply,2=add,3=screen,4=overlay,5=difference,6=exclusion,7=subtract. u_invert: 0/1. u_opacity: 0-1. */
export const TEXT_BLEND_FRAG = `#version 300 es
precision highp float;
uniform sampler2D u_texture;
uniform sampler2D u_texture2;
uniform int u_blendMode;
uniform float u_invert;
uniform float u_opacity;
in vec2 v_uv;
out vec4 outColor;
void main() {
  vec4 mainC = texture(u_texture, v_uv);
  vec4 textC = texture(u_texture2, v_uv);
  if (u_invert > 0.5) {
    textC.rgb = 1.0 - textC.rgb;
  }
  // Coverage is whatever the layer's own chain produced. A media layer is
  // placed into a transparent frame, so its chain carries that alpha with it —
  // and an effect that displaces or blooms past the layer's edges is meant to
  // land outside them, the same way a text layer's does.
  float a = textC.a * u_opacity;
  vec3 mainRgb = mainC.rgb;
  vec3 textRgb = textC.rgb;
  vec3 blended;
  if (u_blendMode == 1) {
    blended = mainRgb * mix(vec3(1.0), textRgb, a);
  } else if (u_blendMode == 2) {
    blended = min(vec3(1.0), mainRgb + textRgb * a * 0.8);
  } else if (u_blendMode == 3) {
    blended = 1.0 - (1.0 - mainRgb) * (1.0 - textRgb * a);
  } else if (u_blendMode == 4) {
    vec3 t = mix(mainRgb, textRgb, a);
    blended = mix(2.0 * mainRgb * t, 1.0 - 2.0 * (1.0 - mainRgb) * (1.0 - t), step(0.5, mainRgb));
  } else if (u_blendMode == 5) {
    blended = mix(mainRgb, abs(mainRgb - textRgb), a);
  } else if (u_blendMode == 6) {
    vec3 t = mix(mainRgb, textRgb, a);
    blended = mainRgb + t - 2.0 * mainRgb * t;
  } else if (u_blendMode == 7) {
    blended = mix(mainRgb, max(vec3(0.0), mainRgb - textRgb), a);
  } else {
    blended = mix(mainRgb, textRgb, a);
  }
  // Source-over coverage rather than a flat 1.0. Over the image this is still
  // 1.0 (the frame is opaque), but this same pass runs inside a text layer's
  // own chain — tracking and captions composite through it — where the input is
  // the transparent drawn text. Forcing alpha there made the whole layer opaque,
  // so compositing it back over the frame hid the image completely.
  float outA = mainC.a + a * (1.0 - mainC.a);
  outColor = vec4(clamp(blended, 0.0, 1.0), clamp(outA, 0.0, 1.0));
}`;

export interface PrePassDef {
	fragment: string;
	/** Use LINEAR texture filtering for this pass (smoother sampling). */
	linearFilter?: boolean;
}

export interface EffectShaderDef {
	fragment: string;
	/** Pre-passes rendered before the main fragment (for multi-pass effects like bloom). */
	prePasses?: PrePassDef[];
	/** Sample the chain input with LINEAR filtering for the main pass (smooth warps like swirl). */
	linearFilter?: boolean;
	/**
	 * Allocate this effect's u_feedback history as half-float instead of RGBA8.
	 * Needed by simulations whose per-frame deltas fall below 8-bit quantization
	 * (they stall into flat blobs otherwise).
	 */
	hdrFeedback?: boolean;
	/**
	 * This shader paints its own background over the whole frame (halftone's
	 * paper), so it can't preserve the transparency of what it was handed. On a
	 * text layer it fills the frame instead of following the text.
	 */
	opaqueOutput?: boolean;
	animated?: boolean;
	setUniforms: (
		gl: WebGL2RenderingContext,
		locs: Record<string, WebGLUniformLocation>,
		values: Record<string, number | string>,
	) => void;
}

function setFloat(
	gl: WebGL2RenderingContext,
	locs: Record<string, WebGLUniformLocation>,
	name: string,
	value: number,
) {
	if (locs[name]) gl.uniform1f(locs[name], value);
}

function setInt(
	gl: WebGL2RenderingContext,
	locs: Record<string, WebGLUniformLocation>,
	name: string,
	value: number,
) {
	if (locs[name]) gl.uniform1i(locs[name], value);
}

/**
 * Parsed colors, keyed by the hex string. A color only changes when its param
 * does, but setUniforms runs every frame — so without this every frame paid a
 * regex, a parseInt and two array allocations per color.
 */
const colorVecs = new Map<string, Float32Array>();

function colorVec(hex: string): Float32Array {
	let vec = colorVecs.get(hex);
	if (!vec) {
		vec = new Float32Array(hexToVec3(hex));
		// Dragging a color picker mints a key per step; don't grow forever.
		if (colorVecs.size > 256) colorVecs.clear();
		colorVecs.set(hex, vec);
	}
	return vec;
}

/** Set a vec3 uniform from a hex color param. */
function setColor(
	gl: WebGL2RenderingContext,
	locs: Record<string, WebGLUniformLocation>,
	name: string,
	hex: string,
) {
	if (locs[name]) gl.uniform3fv(locs[name], colorVec(hex));
}

/** Create a setUniforms that maps each key to a float uniform named u_{key}. */
function floats(...keys: string[]): EffectShaderDef['setUniforms'] {
	return (gl, l, v) => {
		for (const key of keys) setFloat(gl, l, `u_${key}`, v[key] as number);
	};
}

/** Plain horizontal Gaussian (no threshold) — Blur effect pass 1. */
const BLUR_H_FRAG = `uniform float u_radius;
uniform vec2 u_resolution;
void main() {
  // Pixel size from the full output resolution (not the pre-pass buffer), so
  // the screen-space blur width is invariant to pre-pass downsampling.
  vec2 px = 1.0 / u_resolution;
  float spread = u_radius * 3.0;
  float sigma = spread * 0.4;
  float invSigma2 = 1.0 / max(sigma * sigma, 0.001);
  vec4 sum = vec4(0.0);
  float totalW = 0.0;
  const int R = 16;
  float step = spread / float(R);
  for (int i = -R; i <= R; i++) {
    float fi = float(i) * step;
    float w = exp(-fi * fi * invSigma2);
    sum += texture(u_texture, v_uv + vec2(fi * px.x, 0.0)) * w;
    totalW += w;
  }
  outColor = sum / totalW;
}`;

const GLOW_VBLUR_FRAG = `uniform float u_radius;
uniform vec2 u_resolution;
void main() {
  vec2 px = 1.0 / u_resolution;
  float spread = u_radius * 3.0;
  float sigma = spread * 0.4;
  float invSigma2 = 1.0 / max(sigma * sigma, 0.001);
  vec4 bloom = vec4(0.0);
  float totalW = 0.0;
  const int R = 16;
  float step = spread / float(R);
  for (int i = -R; i <= R; i++) {
    float fi = float(i) * step;
    float w = exp(-fi * fi * invSigma2);
    vec2 off = vec2(0.0, fi * px.y);
    bloom += texture(u_texture, v_uv + off) * w;
    totalW += w;
  }
  outColor = bloom / totalW;
}`;

export const EFFECT_SHADERS: Record<string, EffectShaderDef> = {
	pixelate: {
		fragment:
			H +
			`uniform float u_size;
void main() {
  vec2 ts = vec2(textureSize(u_texture, 0));
  float cs = max(1.0, u_size);
  vec2 cell = (floor(v_uv * ts / cs) + 0.5) * cs;
  outColor = texture(u_texture, cell / ts);
}`,
		setUniforms: floats('size'),
	},

	posterize: {
		fragment:
			H +
			`uniform float u_levels;
void main() {
  vec4 c = texture(u_texture, v_uv);
  float n = max(2.0, u_levels);
  outColor = vec4(floor(c.rgb * n + 0.5) / n, c.a);
}`,
		setUniforms: floats('levels'),
	},

	solarize: {
		fragment:
			H +
			HSV_GLSL +
			`uniform float u_pivot;
uniform float u_curve;
uniform float u_colorize;
void main() {
  vec4 c = texture(u_texture, v_uv);
  vec3 hsv = rgb2hsv(c.rgb);

  // The Sabattier fold: gamma the value channel, then reflect it about the
  // pivot. Everything below the pivot inverts (shadows come back as
  // highlights), everything above it climbs from black, and the pivot itself
  // lands on zero — that dark band through the midtones is the whole effect.
  float v = pow(hsv.z, u_curve);
  float folded = v < u_pivot
    ? 1.0 - v / max(u_pivot, 1e-4)
    : (v - u_pivot) / max(u_pivot, 1e-4);

  // Saturation follows how bright the pixel *was*, not what the fold turned it
  // into, so the colour that survives tracks the original image rather than
  // the inverted one. Scaled right down: a darkroom solarization is close to
  // monochrome with a colour cast, and holding full saturation here just reads
  // as a hue-shifted negative.
  float sat = hsv.y * hsv.z * u_colorize;

  outColor = vec4(clamp(hsv2rgb(vec3(hsv.x, sat, folded)), 0.0, 1.0), c.a);
}`,
		setUniforms: floats('pivot', 'curve', 'colorize'),
	},

	edges: {
		fragment:
			H +
			`uniform float u_strength;
uniform float u_mix;
void main() {
  vec2 px = 1.0 / vec2(textureSize(u_texture, 0));
  vec4 tl = texture(u_texture, v_uv + vec2(-px.x, -px.y));
  vec4 tm = texture(u_texture, v_uv + vec2( 0.0,  -px.y));
  vec4 tr = texture(u_texture, v_uv + vec2( px.x, -px.y));
  vec4 ml = texture(u_texture, v_uv + vec2(-px.x,  0.0));
  vec4 mr = texture(u_texture, v_uv + vec2( px.x,  0.0));
  vec4 bl = texture(u_texture, v_uv + vec2(-px.x,  px.y));
  vec4 bm = texture(u_texture, v_uv + vec2( 0.0,   px.y));
  vec4 br = texture(u_texture, v_uv + vec2( px.x,  px.y));
  vec4 gx = -tl - 2.0*ml - bl + tr + 2.0*mr + br;
  vec4 gy = -tl - 2.0*tm - tr + bl + 2.0*bm + br;
  vec4 edge = sqrt(gx*gx + gy*gy) * u_strength;
  vec4 orig = texture(u_texture, v_uv);
  outColor = vec4(mix(orig.rgb, edge.rgb, u_mix), orig.a);
}`,
		setUniforms: floats('strength', 'mix'),
	},

	'neon-edges': {
		fragment:
			H +
			HSV_GLSL +
			`uniform float u_strength;
uniform float u_glow;
uniform float u_bg;

void main() {
  vec2 px = 1.0 / vec2(textureSize(u_texture, 0));
  vec4 orig = texture(u_texture, v_uv);

  // Sobel on pre-blurred luminance — sample each tap as a 2x2 average to
  // suppress pixel-level noise and produce smooth, organic edges
  vec3 luma = vec3(0.299, 0.587, 0.114);
  vec2 h = px * 0.5;
  #define SLUM(o) dot( \
    texture(u_texture, v_uv+(o)+vec2(-h.x,-h.y)).rgb + \
    texture(u_texture, v_uv+(o)+vec2( h.x,-h.y)).rgb + \
    texture(u_texture, v_uv+(o)+vec2(-h.x, h.y)).rgb + \
    texture(u_texture, v_uv+(o)+vec2( h.x, h.y)).rgb, luma) * 0.25
  vec2 S = px * 1.5;
  float tl = SLUM(vec2(-S.x,-S.y));
  float tm = SLUM(vec2( 0.0,-S.y));
  float tr = SLUM(vec2( S.x,-S.y));
  float ml = SLUM(vec2(-S.x, 0.0));
  float mr = SLUM(vec2( S.x, 0.0));
  float bl = SLUM(vec2(-S.x, S.y));
  float bm = SLUM(vec2( 0.0, S.y));
  float br = SLUM(vec2( S.x, S.y));
  #undef SLUM
  float gx = -tl - 2.0*ml - bl + tr + 2.0*mr + br;
  float gy = -tl - 2.0*tm - tr + bl + 2.0*bm + br;
  float edge = clamp(sqrt(gx*gx + gy*gy) * u_strength, 0.0, 1.0);

  // Neon: original hue at full saturation + brightness
  vec3 hsv = rgb2hsv(orig.rgb);
  vec3 neon = hsv2rgb(vec3(hsv.x, 1.0, 1.0));

  // Glow: 5x5 blur of neon signal from neighborhood
  vec3 glowAccum = vec3(0.0);
  for (int x = -2; x <= 2; x++) {
    for (int y = -2; y <= 2; y++) {
      vec2 off = vec2(float(x), float(y)) * px * 3.0;
      vec3 s = texture(u_texture, v_uv + off).rgb;
      vec3 sh = rgb2hsv(s);
      glowAccum += hsv2rgb(vec3(sh.x, 1.0, 1.0));
    }
  }
  glowAccum /= 25.0;

  // Background: original dimmed in non-edge areas
  vec3 bg = orig.rgb * u_bg * (1.0 - edge);

  // Composite: sharp neon edges + soft glow halo + dim bg
  vec3 result = neon * edge + glowAccum * sqrt(edge) * u_glow * 0.4 + bg;
  outColor = vec4(clamp(result, 0.0, 1.0), orig.a);
}`,
		setUniforms: floats('strength', 'glow', 'bg'),
	},

	bleach: {
		fragment:
			H +
			`uniform float u_amount;
void main() {
  vec4 c = texture(u_texture, v_uv);
  float luma = dot(c.rgb, vec3(0.299, 0.587, 0.114));
  vec3 b = (vec3(luma) - 0.5) * 1.5 + 0.5;
  outColor = vec4(mix(c.rgb, clamp(b, 0.0, 1.0), u_amount), c.a);
}`,
		setUniforms: floats('amount'),
	},

	sharpen: {
		fragment:
			H +
			`uniform float u_amount;
uniform float u_radius;
uniform float u_threshold;
void main() {
  vec2 px = 1.0 / vec2(textureSize(u_texture, 0)) * u_radius;
  vec4 c = texture(u_texture, v_uv);

  // 3x3 Gaussian blur (sigma ~0.85)
  // Weights: center=4/16, edges=2/16, corners=1/16
  vec3 blur =
    texture(u_texture, v_uv + vec2(-px.x, -px.y)).rgb * 1.0 +
    texture(u_texture, v_uv + vec2(   0., -px.y)).rgb * 2.0 +
    texture(u_texture, v_uv + vec2( px.x, -px.y)).rgb * 1.0 +
    texture(u_texture, v_uv + vec2(-px.x,    0.)).rgb * 2.0 +
    c.rgb * 4.0 +
    texture(u_texture, v_uv + vec2( px.x,    0.)).rgb * 2.0 +
    texture(u_texture, v_uv + vec2(-px.x,  px.y)).rgb * 1.0 +
    texture(u_texture, v_uv + vec2(   0.,  px.y)).rgb * 2.0 +
    texture(u_texture, v_uv + vec2( px.x,  px.y)).rgb * 1.0;
  blur /= 16.0;

  // Unsharp mask: detail = original - blurred
  vec3 detail = c.rgb - blur;
  vec3 mask = step(vec3(u_threshold), abs(detail));
  outColor = vec4(clamp(c.rgb + detail * u_amount * mask, 0.0, 1.0), c.a);
}`,
		setUniforms: floats('amount', 'radius', 'threshold'),
	},

	mirror: {
		fragment:
			H +
			BOUNCE_GLSL +
			`uniform float u_amount;
uniform int u_side;
uniform float u_position;
void main() {
  vec2 uv = v_uv;
  if (u_side == 0 && uv.x > u_position) uv.x = bounce(2.0 * u_position - uv.x);
  else if (u_side == 1 && uv.x < u_position) uv.x = bounce(2.0 * u_position - uv.x);
  else if (u_side == 2 && uv.y > u_position) uv.y = bounce(2.0 * u_position - uv.y);
  else if (u_side == 3 && uv.y < u_position) uv.y = bounce(2.0 * u_position - uv.y);
  outColor = mix(texture(u_texture, v_uv), texture(u_texture, uv), u_amount);
}`,
		setUniforms: (gl, l, v) => {
			setFloat(gl, l, 'u_amount', v.amount as number);
			setInt(gl, l, 'u_side', v.side as number);
			setFloat(gl, l, 'u_position', v.position as number);
		},
	},

	kaleido: {
		fragment:
			H +
			BOUNCE_GLSL +
			`uniform float u_amount;
uniform float u_sides;
uniform float u_angle;
void main() {
  vec2 uv = v_uv - 0.5;
  float r = length(uv);
  float a = atan(uv.y, uv.x) + u_angle * 0.01745329;
  float seg = 6.28318530 / u_sides;
  a = mod(a, seg);
  a = abs(a - seg * 0.5);
  vec2 kUV = vec2(cos(a), sin(a)) * r + 0.5;
  kUV = vec2(bounce(kUV.x), bounce(kUV.y));
  outColor = mix(texture(u_texture, v_uv), texture(u_texture, kUV), u_amount);
}`,
		setUniforms: floats('amount', 'sides', 'angle'),
	},

	'channel-split': {
		fragment:
			H +
			`uniform int u_mode;
uniform float u_amount;
uniform float u_angle;
uniform float u_falloff;
uniform float u_saturation;
uniform float u_speed;
void main() {
  vec2 px = 1.0 / vec2(textureSize(u_texture, 0));

  if (u_mode == 0) {
    // Linear: uniform offset along angle
    float rad = u_angle * 3.14159265 / 180.0;
    vec2 d = vec2(cos(rad), sin(rad)) * u_amount * px;
    outColor = vec4(
      texture(u_texture, v_uv + d).r,
      texture(u_texture, v_uv).g,
      texture(u_texture, v_uv - d).b,
      texture(u_texture, v_uv).a
    );
  } else if (u_mode == 1) {
    // Radial: offset from center, stronger at edges
    vec2 center = vec2(0.5);
    vec2 dir = v_uv - center;
    float dist = length(dir);
    float strength = u_amount * pow(dist, 1.0 + u_falloff * 3.0) * 0.002;
    vec2 offset = normalize(dir + 1e-6) * strength;
    outColor = vec4(
      texture(u_texture, v_uv + offset).r,
      texture(u_texture, v_uv).g,
      texture(u_texture, v_uv - offset).b,
      texture(u_texture, v_uv).a
    );
  } else {
    // Prismatic: position-dependent dispersion + hue rotation, animated
    float t = u_time * u_speed;
    float rad = u_angle * 3.14159265 / 180.0;
    vec2 dir = vec2(cos(rad), sin(rad));
    float pos = dot(v_uv - 0.5, dir);
    float disp = u_amount * 0.0016;
    float drift = sin(t * 0.3) * 0.5;
    vec2 uvR = v_uv - dir * disp * (pos + drift);
    vec2 uvB = v_uv + dir * disp * (pos + drift);
    float r = texture(u_texture, uvR).r;
    float g = texture(u_texture, v_uv).g;
    float b = texture(u_texture, uvB).b;
    // Widest coverage of the three taps, so a split text layer keeps every
    // channel it displaced.
    float a = max(texture(u_texture, uvR).a,
                  max(texture(u_texture, v_uv).a, texture(u_texture, uvB).a));
    vec3 color = vec3(r, g, b);
    float hueShift = pos * u_amount * 0.1 + t * 0.2;
    float cosH = cos(hueShift);
    float sinH = sin(hueShift);
    vec3 k = vec3(0.57735);
    vec3 rotated = color * cosH + cross(k, color) * sinH + k * dot(k, color) * (1.0 - cosH);
    color = mix(color, rotated, u_saturation);
    outColor = vec4(color, a);
  }
}`,
		animated: true,
		setUniforms: (gl, l, v) => {
			const mode = v.mode === 'radial' ? 1 : v.mode === 'prismatic' ? 2 : 0;
			setInt(gl, l, 'u_mode', mode);
			setFloat(gl, l, 'u_amount', v.amount as number);
			setFloat(gl, l, 'u_angle', v.angle as number);
			setFloat(gl, l, 'u_falloff', v.falloff as number);
			setFloat(gl, l, 'u_saturation', v.saturation as number);
			setFloat(gl, l, 'u_speed', v.speed as number);
		},
	},

	'color-correction': {
		fragment:
			H +
			HUE_ROTATE_GLSL +
			`uniform float u_brightness;
uniform float u_contrast;
uniform float u_hue;
uniform float u_saturation;
void main() {
  vec4 c = texture(u_texture, v_uv);
  vec3 rgb = c.rgb * pow(2.0, u_brightness * 2.0);
  float ct = u_contrast < 0.0 ? 1.0 + u_contrast : 1.0 + u_contrast * u_contrast * 10.0;
  rgb = (rgb - 0.5) * ct + 0.5;
  rgb = hueRotate(rgb, u_hue);
  float luma = dot(rgb, vec3(0.299, 0.587, 0.114));
  rgb = mix(vec3(luma), rgb, 1.0 + u_saturation);
  outColor = vec4(clamp(rgb, 0.0, 1.0), c.a);
}`,
		setUniforms: floats('brightness', 'contrast', 'hue', 'saturation'),
	},

	vignette: {
		fragment:
			H +
			`uniform float u_size;
uniform float u_amount;
uniform float u_transparent;
void main() {
  vec4 c = texture(u_texture, v_uv);
  float dist = length(v_uv - 0.5);
  float radius = 1.0 - u_size;
  float vig = smoothstep(radius, radius - 0.45, dist);
  float fade = mix(1.0, vig, u_amount);
  // Same falloff either way; transparent spends it on alpha instead of on the
  // colour, so whatever sits under the layer shows through the edge rather
  // than getting painted over in black.
  outColor = u_transparent > 0.5 ? vec4(c.rgb, c.a * fade) : vec4(c.rgb * fade, c.a);
}`,
		setUniforms: floats('size', 'amount', 'transparent'),
	},

	scanlines: {
		fragment:
			H +
			`uniform float u_count;
uniform float u_amount;
void main() {
  vec4 c = texture(u_texture, v_uv);
  float line = sin((v_uv.y + u_time * 0.1) * u_count * 3.14159265) * 0.5 + 0.5;
  outColor = vec4(c.rgb * mix(1.0, line, u_amount), c.a);
}`,
		animated: true,
		setUniforms: floats('count', 'amount'),
	},

	bulge: {
		fragment:
			H +
			`uniform float u_amount;
uniform float u_radius;
void main() {
  vec2 center = vec2(0.5);
  vec2 uv = v_uv - center;
  float dist = length(uv);
  if (dist > 0.0 && dist < u_radius) {
    float pct = dist / u_radius;
    float distortion = pow(pct, 1.0 - u_amount) * u_radius;
    uv = uv / dist * distortion;
  }
  outColor = texture(u_texture, uv + center);
}`,
		setUniforms: floats('amount', 'radius'),
	},

	jitter: {
		fragment:
			H +
			`uniform float u_amount;
float hash(vec2 p) {
  return fract(sin(dot(p, vec2(12.9898, 78.233))) * 43758.5453);
}
void main() {
  vec2 px = 1.0 / vec2(textureSize(u_texture, 0));
  float t = floor(u_time * 15.0);
  vec2 off = vec2(
    hash(vec2(floor(v_uv.y * 500.0), t)) - 0.5,
    hash(vec2(floor(v_uv.x * 500.0), t + 1.0)) - 0.5
  ) * u_amount * px;
  outColor = texture(u_texture, v_uv + off);
}`,
		animated: true,
		setUniforms: floats('amount'),
	},

	wobble: {
		fragment:
			H +
			`uniform float u_amount;
uniform float u_frequency;
uniform float u_speed;

// Value noise helpers
float hash(vec2 p) {
  return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453);
}
float noise(vec2 p) {
  vec2 i = floor(p);
  vec2 f = fract(p);
  f = f * f * (3.0 - 2.0 * f); // smoothstep
  return mix(
    mix(hash(i), hash(i + vec2(1.0, 0.0)), f.x),
    mix(hash(i + vec2(0.0, 1.0)), hash(i + vec2(1.0, 1.0)), f.x),
    f.y
  );
}
// Fractal Brownian motion — 3 octaves
float fbm(vec2 p) {
  float v = 0.0;
  v += 0.5    * noise(p); p *= 2.13;
  v += 0.25   * noise(p); p *= 2.07;
  v += 0.125  * noise(p);
  return v / 0.875;
}

void main() {
  vec2 px = 1.0 / vec2(textureSize(u_texture, 0));
  float t = u_time * u_speed;
  vec2 st = v_uv * u_frequency;

  // 2D noise-based displacement — varies in both axes
  float ox = fbm(st + vec2(t * 0.7, t * 0.3)) - 0.5;
  float oy = fbm(st + vec2(t * -0.4, t * 0.8) + 50.0) - 0.5;

  vec2 off = vec2(ox, oy) * 2.0 * u_amount * px;
  outColor = texture(u_texture, v_uv + off);
}`,
		animated: true,
		setUniforms: floats('amount', 'frequency', 'speed'),
	},

	slices: {
		fragment:
			H +
			`uniform float u_count;
uniform float u_offset;
uniform int u_direction;
float hash(float n) { return fract(sin(n) * 43758.5453); }
void main() {
  vec2 uv = v_uv;
  vec2 px = 1.0 / vec2(textureSize(u_texture, 0));
  if (u_direction == 0) {
    float slice = floor(uv.y * u_count);
    uv.x += (hash(slice) - 0.5) * u_offset * px.x;
  } else {
    float slice = floor(uv.x * u_count);
    uv.y += (hash(slice) - 0.5) * u_offset * px.y;
  }
  outColor = texture(u_texture, uv);
}`,
		setUniforms: (gl, l, v) => {
			setFloat(gl, l, 'u_count', v.count as number);
			setFloat(gl, l, 'u_offset', v.offset as number);
			setInt(gl, l, 'u_direction', v.direction === 'vertical' ? 1 : 0);
		},
	},

	shake: {
		fragment:
			H +
			`uniform float u_amount;
uniform float u_speed;
float hash(float n) { return fract(sin(n * 12.9898) * 43758.5453); }
void main() {
  vec2 px = 1.0 / vec2(textureSize(u_texture, 0));
  float t = floor(u_time * u_speed);
  vec2 off = vec2(
    (hash(t) - 0.5) * 2.0,
    (hash(t + 7.0) - 0.5) * 2.0
  ) * u_amount * px;
  outColor = texture(u_texture, v_uv + off);
}`,
		animated: true,
		setUniforms: floats('amount', 'speed'),
	},

	glow: {
		prePasses: [
			{
				// Pass 1: threshold + horizontal Gaussian blur
				fragment:
					H +
					`uniform float u_cutoff;
uniform float u_radius;
uniform vec2 u_resolution;
void main() {
  vec2 px = 1.0 / u_resolution;
  float spread = u_radius * 3.0;
  float sigma = spread * 0.4;
  float invSigma2 = 1.0 / max(sigma * sigma, 0.001);
  vec3 bloom = vec3(0.0);
  float totalW = 0.0;
  const int R = 16;
  float step = spread / float(R);
  for (int i = -R; i <= R; i++) {
    float fi = float(i) * step;
    float w = exp(-fi * fi * invSigma2);
    vec2 off = vec2(fi * px.x, 0.0);
    vec3 s = texture(u_texture, v_uv + off).rgb;
    float luma = dot(s, vec3(0.299, 0.587, 0.114));
    float contrib = max(0.0, luma - u_cutoff);
    bloom += s * contrib * contrib * w;
    totalW += w;
  }
  bloom /= totalW;
  outColor = vec4(bloom, 1.0);
}`,
				linearFilter: true,
			},
			{
				// Pass 2: vertical Gaussian blur
				fragment: H + GLOW_VBLUR_FRAG,
				linearFilter: true,
			},
		],
		// Final pass: composite blurred bloom with original
		fragment:
			H +
			`uniform float u_amount;
uniform sampler2D u_original;
void main() {
  vec4 orig = texture(u_original, v_uv);
  vec3 bloom = texture(u_texture, v_uv).rgb;
  // The halo carries its own coverage, so glow spreads past the edge of a text
  // layer instead of being clipped to the glyphs. No-op on an opaque image.
  float halo = dot(bloom * u_amount, vec3(0.299, 0.587, 0.114));
  outColor = vec4(orig.rgb + bloom * u_amount, clamp(max(orig.a, halo), 0.0, 1.0));
}`,
		setUniforms: floats('amount', 'cutoff', 'radius'),
	},

	'soft-glitch': {
		fragment:
			H +
			`uniform float u_amount;
float h1(float n) { return fract(sin(n) * 43758.5453); }
float vnoise(float x) {
  float i = floor(x);
  float f = fract(x);
  return mix(h1(i), h1(i + 1.0), f * f * (3.0 - 2.0 * f));
}
// rotate hue by angle (radians)
vec3 hrot(vec3 c, float a) {
  float ca = cos(a), sa = sin(a);
  vec3 k = vec3(0.57735);
  return c*ca + cross(k,c)*sa + k*dot(k,c)*(1.0-ca);
}
void main() {
  float strength = u_amount / 50.0;
  float t = u_time;

  // Burst/calm envelope: long quiet stretches, then violent fits
  float burst = smoothstep(0.55, 0.85, vnoise(t * 0.45));
  float activity = strength * (0.15 + 1.6 * burst);

  vec2 readUV = v_uv;
  float hueShift = 0.0;
  float ghost = 0.0;
  float invertFlash = 0.0;

  // 6 bands, each on its OWN clock speed -> poly-rhythm, never one pulse
  for (int i = 0; i < 6; i++) {
    float fi = float(i);
    float clock = 1.3 + h1(fi * 9.7) * 4.2;
    float et = floor(t * clock);
    if (h1(et * 0.41 + fi * 4.1) > activity + 0.18) continue;

    float top = h1(et * 1.7 + fi * 6.3);
    float ht  = mix(0.02, 0.28, h1(et * 3.1 + fi * 2.9));
    float y = v_uv.y;
    if (y < top || y >= top + ht) continue;

    float typeR = h1(et * 5.3 + fi * 8.7);
    if (typeR < 0.25) {
      // content stolen from another row
      float srcY = h1(et * 2.9 + fi * 1.3);
      readUV = vec2(v_uv.x, srcY + fract(y - top) * ht);
    } else if (typeR < 0.5) {
      // horizontal shift + wrong-color hue rotation
      float xOff = (h1(et * 7.1 + fi) - 0.5) * strength * 1.8;
      readUV = vec2(clamp(v_uv.x + xOff, 0.0, 1.0), y);
      hueShift = h1(et * 3.3 + fi * 5.5) * 6.28;
    } else if (typeR < 0.68) {
      // row-duplication stutter
      float stripeH = ht / 4.0;
      float srcRow = top + h1(et * 4.4 + fi) * ht * 0.5;
      readUV = vec2(v_uv.x, srcRow + mod(y - top, stripeH));
    } else if (typeR < 0.84) {
      // vertical slip: the band slides up/down
      float yOff = (h1(et * 6.2 + fi) - 0.5) * strength * 0.8;
      readUV = vec2(v_uv.x, clamp(y + yOff, 0.0, 1.0));
      hueShift = (h1(et * 1.9 + fi) - 0.5) * 1.2;
    } else {
      // ghost echo: translucent shifted duplicate
      ghost = 0.4 + h1(et * 8.8 + fi) * 0.4;
    }
    break;
  }

  // Rare full-frame events, only during bursts
  float ft = floor(t * 14.0);
  if (burst > 0.0 && h1(ft * 0.173) > 1.0 - 0.06 * burst) {
    float kind = h1(ft * 0.731);
    if (kind < 0.45) {
      // full-frame tear below a random line
      float tearY = h1(ft * 1.37);
      float off = (h1(ft * 2.11) - 0.5) * strength * 1.2;
      if (readUV.y > tearY) readUV.x = clamp(readUV.x + off, 0.0, 1.0);
    } else if (kind < 0.75) {
      invertFlash = 1.0;
    } else {
      hueShift += 3.14159;
    }
  }

  vec4 s = texture(u_texture, readUV);
  if (ghost > 0.0) {
    vec2 gOff = vec2((h1(floor(t * 3.0) * 7.7) - 0.5) * 0.24 * strength,
                     (h1(floor(t * 3.0) * 3.3) - 0.5) * 0.05);
    vec4 g = texture(u_texture, clamp(v_uv + gOff, vec2(0.0), vec2(1.0)));
    s.rgb = mix(s.rgb, max(s.rgb, g.rgb), ghost);
  }
  if (hueShift != 0.0) s.rgb = hrot(s.rgb, hueShift);
  if (invertFlash > 0.5) s.rgb = 1.0 - s.rgb;
  outColor = s;
}`,
		animated: true,
		setUniforms: floats('amount'),
	},

	'optical-flow': {
		fragment:
			H +
			`uniform float u_amount;
void main() {
  vec2 px = 1.0 / vec2(textureSize(u_texture, 0));
  vec3 lum = vec3(0.299, 0.587, 0.114);
  float t = u_time * 0.2;

  float r = 3.0 * max(px.x, px.y);

  // 4th-order central-difference gradient — smooth, suppresses per-pixel noise
  float gxN2 = dot(texture(u_texture, v_uv - vec2(2.0*r, 0.0)).rgb, lum);
  float gxN1 = dot(texture(u_texture, v_uv - vec2(    r, 0.0)).rgb, lum);
  float gxP1 = dot(texture(u_texture, v_uv + vec2(    r, 0.0)).rgb, lum);
  float gxP2 = dot(texture(u_texture, v_uv + vec2(2.0*r, 0.0)).rgb, lum);
  float gyN2 = dot(texture(u_texture, v_uv - vec2(0.0, 2.0*r)).rgb, lum);
  float gyN1 = dot(texture(u_texture, v_uv - vec2(0.0,     r)).rgb, lum);
  float gyP1 = dot(texture(u_texture, v_uv + vec2(0.0,     r)).rgb, lum);
  float gyP2 = dot(texture(u_texture, v_uv + vec2(0.0, 2.0*r)).rgb, lum);
  float gx = (-gxP2 + 8.0*gxP1 - 8.0*gxN1 + gxN2) * (1.0/12.0);
  float gy = (-gyP2 + 8.0*gyP1 - 8.0*gyN1 + gyN2) * (1.0/12.0);

  // Curl of luminance gradient = divergence-free flow (follows colour contours)
  vec2 curl = vec2(-gy, gx);

  // Two layered sine waves at incommensurate frequencies — live animation
  float d1 = sin(v_uv.x * 3.1 + t) * cos(v_uv.y * 2.7 - t * 0.73);
  float d2 = sin(v_uv.y * 4.3 - t * 1.3 + 1.57) * cos(v_uv.x * 3.7 + t * 0.91);
  vec2 drift = vec2(d1, d2) * 0.2;

  // Soft-normalise: ensures both strong-edge and flat regions produce visible flow
  vec2 rawFlow = curl + drift;
  vec2 flowDir = rawFlow / max(length(rawFlow), 0.08);

  // LIC-style streamline accumulation:
  // Step N times backward along the flow direction, blending colours with
  // exponential decay weights — this is what turns a plain warp into the
  // characteristic elongated liquid-paint / pour-paint brush-stroke look.
  float stepLen = r * (1.0 + u_amount * 6.0);
  vec2  stepVec = flowDir * stepLen;

  vec4  color  = vec4(0.0);
  float totalW = 0.0;
  vec2  pos    = v_uv;
  const int N  = 10;
  for (int i = 0; i < N; i++) {
    float w = exp(-2.2 * float(i) / float(N - 1));
    color  += texture(u_texture, pos) * w;
    totalW += w;
    pos    -= stepVec;
  }
  vec4 acc = color / totalW;
  vec3 avg = acc.rgb;

  // Weighted averaging desaturates colours by blending hues toward their
  // neighbours along the streamline. Re-expand chroma to restore vibrancy.
  float avgLuma = dot(avg, lum);
  avg = mix(vec3(avgLuma), avg, 1.35);

  outColor = vec4(clamp(avg, 0.0, 1.0), acc.a);
}`,
		animated: true,
		setUniforms: floats('amount'),
	},

	vhs: {
		fragment:
			H +
			`uniform float u_noise;
uniform float u_tracking;
float hash(vec2 p) {
  return fract(sin(dot(p, vec2(12.9898, 78.233))) * 43758.5453);
}
float hash1(float n) {
  return fract(sin(n * 43758.5453) * 28947.3);
}
void main() {
  vec2 res = vec2(textureSize(u_texture, 0));
  vec2 px = 1.0 / res;
  float t = u_time;
  float tFrame = floor(t * 30.0);
  float row = floor(v_uv.y * res.y);
  float colPx = floor(v_uv.x * res.x);

  // --- Drifting hotspot regions where static concentrates ---
  float hotspot = clamp(0.5 + 0.3 * sin(v_uv.y * 6.0 + t * 0.5)
                            + 0.2 * sin(v_uv.y * 17.0 - t * 0.8), 0.0, 1.0);

  // --- Static bands (2-5 px tall) with random lifetimes ---
  float bandH = 2.0 + hash(vec2(floor(row / 3.0), 444.0)) * 3.0;
  float bandId = floor(row / bandH);
  float lifeLen = 2.0 + floor(hash(vec2(bandId, 123.0)) * 7.0);
  float bandEpoch = floor(tFrame / lifeLen);
  float bandChance = hash(vec2(bandId, bandEpoch * 7.0));
  float isStaticBand = step(1.0 - u_noise * 0.5 * hotspot, bandChance);

  // --- Horizontal displacement of static bands ---
  float shiftDir = hash(vec2(bandId, bandEpoch * 13.0 + 50.0)) - 0.5;
  float shiftAmt = isStaticBand * shiftDir * u_noise * 40.0 * px.x;

  // --- Streak: hot head decaying into a noisy tail; some are dark dropouts ---
  float streakX0 = hash(vec2(bandId * 3.0, bandEpoch + 77.0));
  float lenSeed = hash(vec2(bandId * 7.0, bandEpoch + 33.0));
  float streakLen = 0.03 + lenSeed * 0.15 + step(0.8, lenSeed) * 0.12;
  float sx = (v_uv.x - streakX0) / streakLen;
  float inStreak = isStaticBand * step(0.0, sx) * step(sx, 1.0);
  float env = smoothstep(0.0, 0.1, sx) * pow(max(1.0 - sx, 0.0), 1.6);
  float sparkle = 0.5 + 0.5 * hash(vec2(colPx + bandId * 91.0, tFrame));
  float toneSeed = hash(vec2(bandId, bandEpoch * 3.0));
  float dropout = step(0.75, toneSeed);
  float streakSig = inStreak * env * sparkle * (0.45 + toneSeed * 0.55) * u_noise;

  // --- Per-line jitter + sporadic warp bands ---
  float scanY = floor(v_uv.y * 480.0);
  float lineNoise = (hash(vec2(scanY, floor(t * 10.0))) - 0.5) * u_noise * 4.0 * px.x;
  float warpA = (hash(vec2(floor(v_uv.y * 80.0), floor(t * 6.0))) - 0.5)
    * step(0.75, hash(vec2(floor(v_uv.y * 80.0) + 100.0, floor(t * 6.0))))
    * u_noise * 15.0 * px.x;

  // --- Tracking bars crawling vertically ---
  float bars = 0.0;
  for (int i = 0; i < 4; i++) {
    float fi = float(i);
    float speed = 0.08 + hash1(fi * 7.0 + 1.0) * 0.25;
    float bw = 0.02 + hash1(fi * 13.0 + 3.0) * 0.06;
    float phase = hash1(fi * 19.0 + 5.0);
    float pos = fract(t * speed + phase + sin(t * speed * 3.7 + fi) * 0.08);
    float dist = abs(v_uv.y - pos);
    dist = min(dist, 1.0 - dist);
    float strength = 0.3 + hash1(fi * 11.0 + 9.0) * 0.7;
    bars += smoothstep(bw, 0.0, dist) * strength;
  }
  bars *= u_tracking;
  float barNoise = bars * hash(vec2(colPx, row + tFrame * 31.0));

  float totalWarp = lineNoise + warpA + shiftAmt + bars * 25.0 * px.x;
  float rOff = totalWarp * 1.2;
  float bOff = totalWarp * -0.8;

  // --- Sample with RGB split ---
  vec4 c;
  c.r = texture(u_texture, v_uv + vec2(rOff, 0.0)).r;
  c.g = texture(u_texture, v_uv + vec2(totalWarp * 0.3, 0.0)).g;
  c.b = texture(u_texture, v_uv + vec2(bOff, 0.0)).b;
  c.a = max(texture(u_texture, v_uv + vec2(rOff, 0.0)).a,
            texture(u_texture, v_uv + vec2(bOff, 0.0)).a);

  // --- Streaks: bright ones add, dropouts pull toward black ---
  c.rgb += streakSig * (1.0 - dropout);
  c.rgb -= streakSig * dropout * 1.6;

  // --- Chroma speckle on static bands (blue/yellow shimmer) ---
  float chroma = isStaticBand * u_noise * 0.25;
  c.r += (hash(vec2(colPx * 1.3, row + tFrame)) - 0.5) * chroma;
  c.b += (hash(vec2(colPx * 1.7, row - tFrame)) - 0.5) * chroma;

  // --- Tracking bar interior: noise fill instead of a flat lift ---
  c.rgb = mix(c.rgb, vec3(barNoise), min(bars * 0.45, 0.85));

  outColor = vec4(clamp(c.rgb, 0.0, 1.0), c.a);
}`,
		animated: true,
		setUniforms: (gl, l, v) => {
			setFloat(gl, l, 'u_noise', v.static as number);
			setFloat(gl, l, 'u_tracking', v.tracking as number);
		},
	},

	duotone: {
		fragment:
			H +
			`uniform vec3 u_shadowColor;
uniform vec3 u_highlightColor;
uniform float u_intensity;
void main() {
  vec4 c = texture(u_texture, v_uv);
  float luma = dot(c.rgb, vec3(0.299, 0.587, 0.114));
  vec3 duo = mix(u_shadowColor, u_highlightColor, luma);
  outColor = vec4(mix(c.rgb, duo, u_intensity), c.a);
}`,
		setUniforms: (gl, l, v) => {
			setFloat(gl, l, 'u_intensity', v.intensity as number);
			setColor(gl, l, 'u_shadowColor', v.shadowColor as string);
			setColor(gl, l, 'u_highlightColor', v.highlightColor as string);
		},
	},

	grain: {
		fragment:
			H +
			`uniform float u_amount;
uniform float u_rgb;
uniform int u_blendMode;
// Sine-free hash (Dave Hoskins): stable on ANGLE/D3D where fract(sin(x)*K)
// collapses to a constant for large x — with pixel coords it must not.
float hash(vec2 p) {
  vec3 p3 = fract(vec3(p.xyx) * 0.1031);
  p3 += dot(p3, p3.yzx + 33.33);
  return fract((p3.x + p3.y) * p3.z);
}
vec3 blendSoftLight(vec3 base, vec3 blend) {
  return mix(
    2.0 * base * blend + base * base * (1.0 - 2.0 * blend),
    2.0 * base * (1.0 - blend) + sqrt(base) * (2.0 * blend - 1.0),
    step(0.5, blend)
  );
}
void main() {
  vec4 c = texture(u_texture, v_uv);
  float frame = floor(u_time * 24.0);

  // Hard per-pixel speckle: one hash per pixel, no interpolation — crisp
  // grains that re-seat every frame and boil like film.
  vec2 p = floor(gl_FragCoord.xy) + frame * vec2(13.7, 57.3);

  // RGB mode gives each channel its own grain -> colored speckle
  vec3 g = u_rgb > 0.5
    ? vec3(hash(p), hash(p + 19.19), hash(p + 47.47))
    : vec3(hash(p));

  vec3 result;
  if (u_blendMode == 0) {
    // Additive: uniform response, grain reads in shadows and highlights alike
    result = c.rgb + (g - 0.5) * u_amount * 1.2;
  } else if (u_blendMode == 1) {
    result = mix(c.rgb, blendSoftLight(c.rgb, g), u_amount * 1.5);
  } else {
    result = c.rgb * mix(vec3(1.0), g * 1.6, u_amount);
  }
  outColor = vec4(clamp(result, 0.0, 1.0), c.a);
}`,
		animated: true,
		setUniforms: (gl, l, v) => {
			setFloat(gl, l, 'u_amount', v.amount as number);
			setFloat(gl, l, 'u_rgb', v.rgb as number);
			const mode =
				v.blendMode === 'softlight' ? 1 : v.blendMode === 'multiply' ? 2 : 0;
			setInt(gl, l, 'u_blendMode', mode);
		},
	},

	polar: {
		fragment:
			H +
			BOUNCE_GLSL +
			`uniform float u_amount;
uniform float u_angle;
void main() {
  vec2 uv = v_uv - 0.5;
  float r = length(uv) * 2.0;
  float a = atan(uv.y, uv.x) / 6.28318530 + 0.5 + u_angle / 360.0;
  vec2 polarUV = vec2(fract(a), bounce(r));
  outColor = mix(texture(u_texture, v_uv), texture(u_texture, polarUV), u_amount);
}`,
		setUniforms: floats('amount', 'angle'),
	},

	tile: {
		fragment:
			H +
			`uniform float u_size;
uniform float u_offset;
uniform float u_angle;
void main() {
  float rad = u_angle * 3.14159265 / 180.0;
  float c = cos(rad), s = sin(rad);
  vec2 centered = v_uv - 0.5;
  vec2 rotated = vec2(c * centered.x + s * centered.y, -s * centered.x + c * centered.y) + 0.5;
  vec2 uv = rotated * u_size + u_offset + vec2(u_time * 0.2, 0.0);
  vec2 cell = floor(uv);
  vec2 local = fract(uv);
  vec2 mirrored = mix(local, 1.0 - local, mod(cell, 2.0));
  outColor = texture(u_texture, mirrored);
}`,
		animated: true,
		setUniforms: floats('size', 'offset', 'angle'),
	},

	'data-bend': {
		fragment:
			H +
			`uniform float u_intensity;
uniform float u_corruption;
uniform float u_channelShift;
float hash(vec2 p) {
  return fract(sin(dot(p, vec2(12.9898, 78.233))) * 43758.5453);
}
vec3 hrot(vec3 c, float a) {
  float ca = cos(a), sa = sin(a);
  vec3 k = vec3(0.57735);
  return c*ca + cross(k,c)*sa + k*dot(k,c)*(1.0-ca);
}
void main() {
  vec2 res = vec2(textureSize(u_texture, 0));
  // Corruption layout persists: quantize phase-time coarsely
  float t = floor(u_time * 0.8);

  // Macroblock grid (raster order, like bytes in a file)
  float gridW = 40.0;
  float gridH = max(4.0, floor(gridW * res.y / res.x));
  vec2 grid = vec2(gridW, gridH);
  vec2 bc = floor(v_uv * grid);
  vec2 local = fract(v_uv * grid);
  float bIdx = bc.y * gridW + bc.x;
  float total = gridW * gridH;

  float numZones = floor(2.0 + u_corruption * 10.0);

  vec2 readBlock = bc;
  vec2 readLocal = local;
  float rasterShift = 0.0;
  float garbage = 0.0;
  float hueG = 0.0;

  for (float i = 0.0; i < 12.0; i++) {
    if (i >= numZones) break;
    // Corrupt zones are runs of consecutive blocks in raster order,
    // wrapping row edges like a corrupted byte stream.
    float zStart = floor(hash(vec2(i, t)) * total);
    float zLen = floor((0.01 + hash(vec2(i + 50.0, t)) * 0.06)
      * total * (0.3 + u_intensity));
    float zEnd = zStart + zLen;

    // The classic databend signature: everything AFTER the broken bytes
    // stays shifted sideways for the zone's lifetime.
    if (bIdx >= zEnd) {
      rasterShift += floor((hash(vec2(i * 3.0, t + 7.0)) - 0.5)
        * u_intensity * 7.0);
    }

    if (bIdx >= zStart && bIdx < zEnd) {
      float fate = hash(vec2(i * 11.0, t + 3.0));
      if (fate < 0.45) {
        // wrong content: this block decodes bytes from elsewhere
        float srcIdx = mod(bIdx + floor((hash(vec2(i * 5.0, t)) - 0.5)
          * total * 0.5) + total, total);
        readBlock = vec2(mod(srcIdx, gridW), floor(srcIdx / gridW));
      } else if (fate < 0.75) {
        // smear: the block repeats its first row downward (JPEG streak)
        readLocal.y = readLocal.y * 0.08;
      } else {
        // garbage: posterized hue trash on laterally-shifted content
        garbage = 1.0;
        hueG = hash(vec2(i * 7.0, t + 9.0)) * 6.28;
        readBlock.x = mod(readBlock.x + floor(hash(vec2(i, t + 4.0)) * 8.0), gridW);
      }
    }
  }

  // Re-linearize with the persistent raster shift
  float rIdx = readBlock.y * gridW + readBlock.x + rasterShift;
  rIdx = clamp(rIdx, 0.0, total - 1.0);
  vec2 rb = vec2(mod(rIdx, gridW), floor(rIdx / gridW));
  vec2 uv = (rb + readLocal) / grid;

  // RGB byte misalignment: channels offset by fractions of a block
  float co = u_channelShift * 2.5 / gridW;
  vec3 col;
  col.r = texture(u_texture, clamp(uv, vec2(0.0), vec2(1.0))).r;
  col.g = texture(u_texture, clamp(uv + vec2(co, 0.0), vec2(0.0), vec2(1.0))).g;
  col.b = texture(u_texture, clamp(uv + vec2(co * 2.0, 0.0), vec2(0.0), vec2(1.0))).b;
  float alpha = texture(u_texture, clamp(uv, vec2(0.0), vec2(1.0))).a;

  if (garbage > 0.5) {
    col = floor(col * 5.0) / 5.0;
    col = hrot(col, hueG);
  }
  outColor = vec4(col, alpha);
}`,
		animated: true,
		setUniforms: floats('intensity', 'corruption', 'channelShift'),
	},

	melt: {
		fragment:
			H +
			`uniform float u_amount;
uniform float u_delta;
uniform sampler2D u_feedback;
float hash(vec2 p) {
  return fract(sin(dot(p, vec2(12.9898, 78.233))) * 43758.5453);
}
float vnoise(vec2 p) {
  vec2 i = floor(p);
  vec2 f = fract(p);
  vec2 u = f * f * (3.0 - 2.0 * f);
  return mix(mix(hash(i), hash(i + vec2(1.0, 0.0)), u.x),
             mix(hash(i + vec2(0.0, 1.0)), hash(i + vec2(1.0, 1.0)), u.x), u.y);
}
float fbm(vec2 p) {
  return vnoise(p) * 0.55 + vnoise(p * 2.13 + 5.0) * 0.3
       + vnoise(p * 4.41 + 9.0) * 0.15;
}
void main() {
  vec3 lum = vec3(0.299, 0.587, 0.114);
  vec2 px = 1.0 / vec2(textureSize(u_texture, 0));
  float t = u_time;

  // --- Drip field ---------------------------------------------------------
  // Broad slow columns crossed with fine streaks; wanders gently over time.
  float cols = fbm(vec2(v_uv.x * 4.0, t * 0.05));
  float streaks = fbm(vec2(v_uv.x * 47.0 + 13.0, t * 0.021));
  float drip = cols * cols * (0.3 + 0.7 * streaks);

  // A melting front descends per column, so drips grow downward over time
  // instead of the whole image sliding at once.
  float front = t * u_amount * (0.02 + 0.3 * cols);
  float meltOn = smoothstep(0.0, 0.18, front - v_uv.y);

  // Bright wax runs faster.
  float bright = dot(texture(u_feedback, v_uv).rgb, lum);

  // Per-frame fall distance (uv units), framerate-independent via u_delta.
  float fall = u_delta * u_amount * meltOn
             * (0.05 + 1.6 * drip) * (0.35 + 0.65 * bright) * 0.06;

  // Moving drips swing sideways; amplitude scales with their speed.
  float sway = sin(v_uv.y * 21.0 - t * 1.4 + cols * 6.2831) * fall * 2.2;

  // Advection: this pixel receives what was slightly above it last frame
  // (+v_uv.y is screen-down in effect space).
  vec2 from = vec2(clamp(v_uv.x + sway, 0.0, 1.0),
                   clamp(v_uv.y - fall, 0.0, 1.0));
  vec4 meltedS = texture(u_feedback, from);
  vec3 melted = meltedS.rgb;
  float meltedA = meltedS.a;

  // --- Viscous softening ---------------------------------------------------
  // Only where actually flowing: fast drips smear and blend like wax,
  // untouched areas stay perfectly crisp.
  float visc = 0.7 * clamp(fall / (px.y * 1.5), 0.0, 1.0);
  vec3 up   = texture(u_feedback, clamp(from + vec2(0.0, px.y * 1.5), vec2(0.0), vec2(1.0))).rgb;
  vec3 down = texture(u_feedback, clamp(from - vec2(0.0, px.y * 1.5), vec2(0.0), vec2(1.0))).rgb;
  melted = mix(melted, (melted * 2.0 + up + down) * 0.25, visc);

  // --- Re-solidifying ------------------------------------------------------
  // The source image constantly seeps back through the wax, so the melt
  // reaches a living equilibrium instead of burying the input. Higher
  // amounts drip faster and re-solidify slower, but never fully take over.
  vec4 freshS = texture(u_texture, v_uv);
  vec3 fresh = freshS.rgb;
  float heal = 1.0 - exp(-mix(2.0, 0.25, u_amount) * u_delta);
  melted = mix(melted, fresh, heal);
  meltedA = mix(meltedA, freshS.a, heal);

  // Where the front hasn't arrived yet, show the live chain input so
  // unmelted regions (and upstream animated effects) stay alive.
  vec3 col = mix(fresh, melted, meltOn);

  outColor = vec4(clamp(col, 0.0, 1.0), mix(freshS.a, meltedA, meltOn));
}`,
		animated: true,
		setUniforms: floats('amount'),
	},

	tunnel: {
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
  // usable 0.90–1.00 per-frame multiplier range.
  float fade = 1.0 - u_decay * 0.1;
  vec4 prev = texture(u_feedback, c + 0.5) * pow(fade, u_delta * 60.0);
  vec4 fresh = texture(u_texture, v_uv);
  outColor = vec4(clamp(max(fresh.rgb, prev.rgb), 0.0, 1.0),
                  clamp(max(fresh.a, prev.a), 0.0, 1.0));
}`,
		animated: true,
		setUniforms: floats('zoom', 'spin', 'decay'),
	},

	'audio-bars': {
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
uniform vec3 u_color;
void main() {
  vec4 src = texture(u_texture, v_uv);
  float bars = max(floor(u_bars), 1.0);
  float slot = v_uv.x * bars;
  float idx = floor(slot) / bars;

  // Bass occupies a tiny slice of a linear FFT, so square the lookup to hand
  // the low end most of the width. Sampling linearly leaves every bar past the
  // first few sitting dead for most music.
  float lo = idx * idx;
  float hi = (idx + 1.0 / bars) * (idx + 1.0 / bars);
  float level = 0.0;
  for (int i = 0; i < 8; i++) {
    float f = mix(lo, hi, (float(i) + 0.5) / 8.0);
    // Peak of the bins this bar spans, not their mean — averaging reads as mush.
    level = max(level, texture(u_spectrum, vec2(f, 0.5)).r);
  }
  // Punch reshapes the response the same way it does for volume links: below
  // 1 lifts quiet detail into visible movement, above 1 leaves only the hits.
  level = clamp(pow(level, u_punch) * u_gain, 0.0, 1.0) * u_height;

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
  outColor = vec4(mix(src.rgb, col, clamp(fill, 0.0, 1.0) * u_opacity), src.a);
}`,
		animated: true,
		setUniforms: (gl, l, v) => {
			setFloat(gl, l, 'u_bars', v.bars as number);
			setFloat(gl, l, 'u_height', v.height as number);
			setFloat(gl, l, 'u_gain', v.gain as number);
			// Smoothing is applied on the CPU per instance before the texture upload;
			// only the punch curve is cheap enough to leave to the shader.
			setFloat(
				gl,
				l,
				'u_punch',
				punchExponent(
					typeof v.punch === 'number' ? v.punch : DEFAULT_AUDIO_RESPONSE.punch,
				),
			);
			setFloat(gl, l, 'u_opacity', v.opacity as number);
			setInt(gl, l, 'u_anchor', v.anchor === 'top' ? 1 : v.anchor === 'center' ? 2 : 0);
			setInt(gl, l, 'u_style', v.style === 'segmented' ? 1 : 0);
			setColor(gl, l, 'u_color', v.color as string);
		},
	},

	strobe: {
		fragment:
			H +
			`uniform float u_duty;
uniform float u_amount;
uniform int u_mode;
void main() {
  vec4 c = texture(u_texture, v_uv);
  // u_time arrives as accumulated phase because the rate param is keyed
  // "speed", so one unit is one full flash cycle and changing the rate mid-clip
  // doesn't jump the strobe.
  float phase = fract(u_time);
  float on = step(phase, u_duty);
  vec3 flash = u_mode == 1 ? vec3(1.0)
             : u_mode == 2 ? 1.0 - c.rgb
             : u_mode == 3 ? vec3(dot(c.rgb, vec3(0.299, 0.587, 0.114)))
             : vec3(0.0);
  outColor = vec4(mix(c.rgb, flash, on * u_amount), c.a);
}`,
		animated: true,
		setUniforms: (gl, l, v) => {
			setFloat(gl, l, 'u_duty', v.duty as number);
			setFloat(gl, l, 'u_amount', v.amount as number);
			setInt(
				gl,
				l,
				'u_mode',
				v.mode === 'white' ? 1 : v.mode === 'invert' ? 2 : v.mode === 'mono' ? 3 : 0,
			);
		},
	},

	feedback: {
		fragment:
			H +
			NOISE_GLSL +
			HUE_ROTATE_GLSL +
			`uniform float u_decay;
uniform float u_scale;
uniform float u_rotate;
uniform float u_warp;
uniform float u_hue;
uniform int u_blend;
uniform float u_delta;
uniform sampler2D u_feedback;
void main() {
  // Every transform is per second and scaled by the frame delta, so a trail
  // decays and travels the same distance whatever the frame rate.
  float s = 1.0 - u_scale * u_delta;
  float a = u_rotate * (3.14159265 / 180.0) * u_delta;
  float ca = cos(a), sa = sin(a);
  vec2 c = v_uv - 0.5;
  vec2 from = vec2(ca * c.x - sa * c.y, sa * c.x + ca * c.y) * s + 0.5;

  // Noise drift, so the trail curls away instead of sliding rigidly along the
  // scale/rotate path.
  if (u_warp > 0.0) {
    float nx = fbm(v_uv * 3.0 + u_time * 0.15);
    float ny = fbm(v_uv * 3.0 - u_time * 0.12 + 17.0);
    from += (vec2(nx, ny) - 0.5) * u_warp * 0.5 * u_delta;
  }

  vec4 prev = texture(u_feedback, clamp(from, 0.0, 1.0));
  // The hue shift compounds: each pass through the loop turns the surviving
  // trail a little further, so old ghosts separate in colour from new ones
  // rather than stacking into one grey smear.
  if (u_hue != 0.0) prev.rgb = hueRotate(prev.rgb, u_hue * u_delta);
  prev *= pow(1.0 - u_decay * 0.06, u_delta * 60.0);

  vec4 fresh = texture(u_texture, v_uv);
  vec3 col = u_blend == 1
      ? 1.0 - (1.0 - fresh.rgb) * (1.0 - prev.rgb)
      : u_blend == 2 ? fresh.rgb + prev.rgb : max(fresh.rgb, prev.rgb);
  outColor = vec4(clamp(col, 0.0, 1.0), clamp(max(fresh.a, prev.a), 0.0, 1.0));
}`,
		animated: true,
		setUniforms: (gl, l, v) => {
			setFloat(gl, l, 'u_decay', v.decay as number);
			setFloat(gl, l, 'u_scale', v.scale as number);
			setFloat(gl, l, 'u_rotate', v.rotate as number);
			setFloat(gl, l, 'u_warp', v.warp as number);
			setFloat(gl, l, 'u_hue', v.hue as number);
			setInt(gl, l, 'u_blend', v.blend === 'screen' ? 1 : v.blend === 'add' ? 2 : 0);
		},
	},

	halftone: {
		fragment:
			H +
			`uniform float u_scale;
uniform float u_angle;
uniform float u_contrast;
uniform float u_invert;
uniform int u_mode;
void main() {
  vec2 res = vec2(textureSize(u_texture, 0));
  vec2 pos = v_uv * res;
  vec3 src = texture(u_texture, v_uv).rgb;
  float lum = dot(src, vec3(0.299, 0.587, 0.114));
  lum = clamp((lum - 0.5) * u_contrast + 0.5, 0.0, 1.0);

  float rad = u_angle * 3.14159265 / 180.0;
  float ca = cos(rad), sa = sin(rad);
  vec2 rp = vec2(ca * pos.x + sa * pos.y, -sa * pos.x + ca * pos.y);

  float ink; // 1 = inked
  if (u_mode == 2) {
    // Engraving lines; a second, perpendicular set joins in dark areas
    float aa = 1.5 * 3.14159265 / u_scale;
    float w1 = 0.5 + 0.5 * sin(rp.y * 3.14159265 / u_scale);
    float w2 = 0.5 + 0.5 * sin(rp.x * 3.14159265 / u_scale);
    float l1 = 1.0 - smoothstep(w1 - aa, w1 + aa, lum);
    float l2 = 1.0 - smoothstep(w2 - aa, w2 + aa, lum * 2.0);
    ink = max(l1, l2);
  } else {
    // Classic rotated dot screen: dot area grows with darkness
    vec2 cell = fract(rp / u_scale) - 0.5;
    float r = sqrt(1.0 - lum) * 0.7071;
    ink = smoothstep(r, r - 1.5 / u_scale, length(cell));
  }
  ink = mix(ink, 1.0 - ink, u_invert);
  // Ink takes the source color over paper white
  vec3 col = mix(vec3(1.0), src, ink);
  outColor = vec4(col, 1.0);
}`,
		opaqueOutput: true,
		setUniforms: (gl, l, v) => {
			setFloat(gl, l, 'u_scale', v.scale as number);
			setFloat(gl, l, 'u_angle', v.angle as number);
			setFloat(gl, l, 'u_contrast', v.contrast as number);
			setFloat(gl, l, 'u_invert', v.invert as number);
			setInt(gl, l, 'u_mode', v.mode === 'lines' ? 2 : 0);
		},
	},

	/**
	 * Composite video falling apart. Not a dot screen — the speckle comes from
	 * decoding, so it lands on detail and leaves flat areas alone: luma is
	 * sample-and-held into runs then over-peaked (the ringing rides the run
	 * edges, not the picture's), chroma is decoded at a quarter of that
	 * bandwidth and late so it never sits on the run that produced it, and the
	 * subcarrier beats against luma with its phase flipped every line.
	 */
	composite: {
		fragment:
			H +
			`uniform float u_bleed;
uniform float u_crawl;
uniform float u_crush;
uniform float u_mix;
// Pinned rather than exposed: these four only read as this signal near the top
// of their ranges, so a slider on each is four ways to a worse picture. Tune
// here if the look ever needs to move.
const float RUN = 24.0;
const float LINES = 8.0;
const float RING = 5.0;
const float BLOOM = 2.0;
// Sine-free hash (Dave Hoskins): stable on ANGLE/D3D for large line numbers.
float hash(vec2 p) {
  vec3 p3 = fract(vec3(p.xyx) * 0.1031);
  p3 += dot(p3, p3.yzx + 33.33);
  return fract((p3.x + p3.y) * p3.z);
}
float luma(vec3 c) { return dot(c, vec3(0.299, 0.587, 0.114)); }
vec2 chromaOf(vec3 c) {
  return vec2(dot(c, vec3(0.5959, -0.2746, -0.3213)),
              dot(c, vec3(0.2115, -0.5227, 0.3112)));
}
vec3 yiq2rgb(float y, vec2 c) {
  return vec3(y + 0.956 * c.x + 0.619 * c.y,
              y - 0.272 * c.x - 0.647 * c.y,
              y - 1.106 * c.x + 1.703 * c.y);
}
void main() {
  vec2 res = vec2(textureSize(u_texture, 0));
  vec2 pos = v_uv * res;
  vec4 src = texture(u_texture, v_uv);

  // Everything below is computed per scan line, so nothing lines up vertically
  // — that mismatch between neighbouring lines is the comb texture.
  float row = floor(pos.y / LINES);
  float rowY = (row + 0.5) * LINES;
  float rh = hash(vec2(row, floor(u_time * 24.0)));
  // Hold length wanders line to line; a fixed one would read as a tidy grid.
  float run = RUN * (0.45 + 1.1 * rh);
  float ph = fract(rh * 7.13) * run;

  // Luma: latch one sample and smear it across the run, so an edge leaves a
  // bar of flat value instead of a gradient.
  float held = luma(texture(u_texture, vec2((floor((pos.x + ph) / run) + 0.5) * run - ph, rowY) / res).rgb);
  // Over-peak against a neighbourhood of the *held* signal: the overshoot
  // fires on run boundaries, which is what breaks edges into bright dashes
  // while flat shadow stays flat and crushes away to nothing.
  float mean = 0.0, wsum = 0.0;
  for (int k = -4; k <= 4; k++) {
    float fk = float(k);
    float w = exp(-fk * fk * 0.18);
    float sx = (floor((pos.x + fk * 1.5 + ph) / run) + 0.5) * run - ph;
    mean += luma(texture(u_texture, vec2(sx, rowY) / res).rgb) * w;
    wsum += w;
  }
  float lum = held + RING * (held - mean / wsum);

  // Chroma: averaged over a wide window that ignores the run structure and
  // sits to the left of the pixel, so colour trails behind the luma that made
  // it. Highlights ride the same taps forward into a scan-aligned smear.
  float wide = max(0.5, u_bleed) * 0.25;
  vec2 chroma = vec2(0.0);
  float bloom = 0.0, bwsum = 0.0;
  for (int k = -4; k <= 4; k++) {
    float fk = float(k);
    vec3 s = texture(u_texture, vec2(pos.x + (fk - 1.2) * wide, rowY) / res).rgb;
    chroma += chromaOf(s);
    float bw = exp(-max(0.0, fk) * 0.55) * (fk < 0.0 ? 0.25 : 1.0);
    bloom += max(0.0, luma(s) - 0.55) * bw;
    bwsum += bw;
  }
  chroma /= 9.0;
  bloom /= bwsum;

  // Dot crawl: the subcarrier beating against luma. Its phase inverts every
  // line, so the interference reads as a diagonal hatch rather than a grid,
  // and it drifts because the beat is never quite locked.
  float beat = cos(6.2831853 * pos.x * 0.25 + 3.14159265 * row + u_time * 2.0);
  lum += u_crawl * length(chroma) * beat * 2.0;
  // The same beat as a demodulation phase error, which rainbows the hatch.
  float a = u_crawl * beat * 1.2;
  float ca = cos(a), sa = sin(a);
  chroma = vec2(ca * chroma.x - sa * chroma.y, sa * chroma.x + ca * chroma.y);

  // A wide chroma window averages saturation away; put it back, then crush so
  // only the ringing survives in the shadows.
  vec3 col = yiq2rgb(lum, chroma * (1.4 + u_bleed * 0.03));
  col = (col - u_crush) / max(0.05, 1.0 - u_crush);
  col = clamp(col + bloom * BLOOM, 0.0, 1.0);
  outColor = vec4(mix(src.rgb, col, u_mix), src.a);
}`,
		animated: true,
		setUniforms: floats('bleed', 'crawl', 'crush', 'mix'),
	},

	swirl: {
		fragment:
			H +
			`uniform float u_angle;
uniform float u_radius;
void main() {
  vec2 res = vec2(textureSize(u_texture, 0));
  float aspect = res.x / res.y;
  vec2 c = v_uv - 0.5;
  c.x *= aspect;
  float d = length(c);
  // Whirlpool profile: full twist at the core with a quadratic falloff
  // to zero at u_radius — the shear stays concentrated in the middle
  // instead of streaking the whole disc into rings.
  float infl = 1.0 - smoothstep(0.0, u_radius, d);
  infl *= infl;
  // Bounded rocking around the base twist instead of endless wind-up,
  // so the vortex breathes instead of spiraling into mush.
  float a = (u_angle + sin(u_time * 0.8) * 60.0) * (3.14159265 / 180.0) * infl;
  float ca = cos(a), sa = sin(a);
  vec2 r = vec2(ca * c.x - sa * c.y, sa * c.x + ca * c.y);
  vec2 uv = vec2(r.x / aspect, r.y) + 0.5;
  outColor = texture(u_texture, uv);
}`,
		animated: true,
		linearFilter: true,
		setUniforms: floats('angle', 'radius'),
	},

	ripple: {
		fragment:
			H +
			`uniform float u_amount;
uniform float u_frequency;
void main() {
  vec2 res = vec2(textureSize(u_texture, 0));
  vec2 px = 1.0 / res;
  float aspect = res.x / res.y;
  vec2 c = v_uv - 0.5;
  c.x *= aspect;
  float d = length(c);
  float wave = sin(d * u_frequency * 6.2831 - u_time * 4.0) / (1.0 + d * 3.0);
  vec2 dir = d > 0.0001 ? c / d : vec2(0.0);
  vec2 uv = v_uv + dir * wave * u_amount * px;
  outColor = texture(u_texture, uv);
}`,
		animated: true,
		setUniforms: floats('amount', 'frequency'),
	},

	blur: {
		prePasses: [
			{
				fragment: H + BLUR_H_FRAG,
				linearFilter: true,
			},
			{
				fragment: H + GLOW_VBLUR_FRAG,
				linearFilter: true,
			},
		],
		fragment:
			H +
			`void main() {
  outColor = texture(u_texture, v_uv);
}`,
		setUniforms: floats('radius'),
	},

	'radial-blur': {
		fragment:
			H +
			`uniform float u_strength;
void main() {
  vec2 c = v_uv - 0.5;
  vec4 col = vec4(0.0);
  float total = 0.0;
  for (int i = 0; i < 12; i++) {
    float t = float(i) / 11.0;
    float w = 1.0 - 0.5 * t;
    col += texture(u_texture, v_uv - c * t * u_strength * 0.25) * w;
    total += w;
  }
  outColor = col / total;
}`,
		setUniforms: floats('strength'),
	},

	emboss: {
		fragment:
			H +
			`uniform float u_strength;
uniform float u_angle;
uniform float u_mix;
void main() {
  vec2 px = 1.0 / vec2(textureSize(u_texture, 0));
  float rad = u_angle * 3.14159265 / 180.0;
  vec2 dir = vec2(cos(rad), sin(rad));
  vec2 off = dir * max(px.x, px.y) * 2.0;
  float s1 = dot(texture(u_texture, v_uv - off).rgb, vec3(0.299, 0.587, 0.114));
  float s2 = dot(texture(u_texture, v_uv + off).rgb, vec3(0.299, 0.587, 0.114));
  float diff = (s2 - s1) * u_strength + 0.5;
  vec3 emboss = clamp(vec3(diff), 0.0, 1.0);
  vec4 orig = texture(u_texture, v_uv);
  outColor = vec4(mix(orig.rgb, emboss, u_mix), orig.a);
}`,
		setUniforms: floats('strength', 'angle', 'mix'),
	},

	thermal: {
		fragment:
			H +
			`uniform float u_intensity;
uniform int u_palette;
vec3 thermalRamp(float t) {
  vec3 c0 = vec3(0.0, 0.0, 0.0);
  vec3 c1 = vec3(0.2, 0.0, 0.5);
  vec3 c2 = vec3(0.6, 0.0, 0.6);
  vec3 c3 = vec3(1.0, 0.0, 0.0);
  vec3 c4 = vec3(1.0, 0.5, 0.0);
  vec3 c5 = vec3(1.0, 1.0, 0.0);
  vec3 c6 = vec3(1.0, 1.0, 1.0);
  float s0 = smoothstep(0.0, 0.2, t);
  float s1 = smoothstep(0.2, 0.4, t);
  float s2 = smoothstep(0.4, 0.55, t);
  float s3 = smoothstep(0.55, 0.7, t);
  float s4 = smoothstep(0.7, 0.85, t);
  float s5 = smoothstep(0.85, 1.0, t);
  return mix(mix(mix(mix(mix(mix(c0, c1, s0), c2, s1), c3, s2), c4, s3), c5, s4), c6, s5);
}
vec3 infraredRamp(float t) {
  vec3 c0 = vec3(0.1, 0.0, 0.2);
  vec3 c1 = vec3(0.4, 0.0, 0.5);
  vec3 c2 = vec3(0.8, 0.2, 0.6);
  vec3 c3 = vec3(1.0, 0.6, 0.8);
  vec3 c4 = vec3(1.0, 1.0, 1.0);
  float s0 = smoothstep(0.0, 0.25, t);
  float s1 = smoothstep(0.25, 0.5, t);
  float s2 = smoothstep(0.5, 0.75, t);
  float s3 = smoothstep(0.75, 1.0, t);
  return mix(mix(mix(mix(c0, c1, s0), c2, s1), c3, s2), c4, s3);
}
vec3 nightVisionRamp(float t) {
  vec3 c0 = vec3(0.0, 0.05, 0.0);
  vec3 c1 = vec3(0.0, 0.3, 0.0);
  vec3 c2 = vec3(0.2, 0.6, 0.1);
  vec3 c3 = vec3(0.5, 1.0, 0.4);
  vec3 c4 = vec3(0.9, 1.0, 0.9);
  float s0 = smoothstep(0.0, 0.25, t);
  float s1 = smoothstep(0.25, 0.5, t);
  float s2 = smoothstep(0.5, 0.75, t);
  float s3 = smoothstep(0.75, 1.0, t);
  return mix(mix(mix(mix(c0, c1, s0), c2, s1), c3, s2), c4, s3);
}
void main() {
  vec4 c = texture(u_texture, v_uv);
  float luma = dot(c.rgb, vec3(0.299, 0.587, 0.114));
  vec3 ramp;
  if (u_palette == 0) ramp = thermalRamp(luma);
  else if (u_palette == 1) ramp = infraredRamp(luma);
  else ramp = nightVisionRamp(luma);
  outColor = vec4(mix(c.rgb, ramp, u_intensity), c.a);
}`,
		setUniforms: (gl, l, v) => {
			setFloat(gl, l, 'u_intensity', v.intensity as number);
			const p = v.palette as string;
			setInt(
				gl,
				l,
				'u_palette',
				p === 'infrared' ? 1 : p === 'night-vision' ? 2 : 0,
			);
		},
	},

	'color-halves': {
		fragment:
			H +
			HUE_ROTATE_GLSL +
			`uniform float u_position;
uniform float u_angle;
uniform int u_mode;
uniform float u_amount;
void main() {
  vec4 orig = texture(u_texture, v_uv);
  float rad = u_angle * 3.14159265 / 180.0;
  vec2 center = vec2(0.5);
  vec2 uv = v_uv - center;
  float c = cos(rad), s = sin(rad);
  float proj = uv.x * c + uv.y * s;
  float feather = 0.02;
  float side = smoothstep(u_position - feather, u_position + feather, proj + 0.5);
  vec3 treated = orig.rgb;
  if (u_mode == 0) {
    treated = hueRotate(treated, 180.0);
  } else if (u_mode == 1) {
    treated = hueRotate(treated, 120.0);
  } else if (u_mode == 2) {
    float luma = dot(treated, vec3(0.299, 0.587, 0.114));
    treated = mix(treated, vec3(luma), 1.0);
  } else {
    treated = clamp((orig.rgb - 0.5) * 2.0 + 0.5, 0.0, 1.0);
  }
  vec3 result = mix(orig.rgb, treated, side * u_amount);
  outColor = vec4(result, orig.a);
}`,
		setUniforms: (gl, l, v) => {
			setFloat(gl, l, 'u_position', v.position as number);
			setFloat(gl, l, 'u_angle', v.angle as number);
			const m = v.mode as string;
			setInt(
				gl,
				l,
				'u_mode',
				m === 'hue-shift'
					? 1
					: m === 'desaturate'
						? 2
						: m === 'high-contrast'
							? 3
							: 0,
			);
			setFloat(gl, l, 'u_amount', v.amount as number);
		},
	},

	stereoscopic: {
		fragment:
			H +
			`uniform float u_depth;
uniform float u_angle;
uniform int u_mode;
uniform int u_depthSource;
uniform float u_focus;
void main() {
  vec2 px = 1.0 / vec2(textureSize(u_texture, 0));
  vec4 c = texture(u_texture, v_uv);

  // compute depth value
  float d;
  if (u_depthSource == 0) {
    // luminance-based depth
    d = dot(c.rgb, vec3(0.299, 0.587, 0.114));
  } else if (u_depthSource == 1) {
    // edge-based depth (gradient magnitude)
    float lL = dot(texture(u_texture, v_uv + vec2(-px.x, 0.0)).rgb, vec3(0.299, 0.587, 0.114));
    float lR = dot(texture(u_texture, v_uv + vec2( px.x, 0.0)).rgb, vec3(0.299, 0.587, 0.114));
    float lT = dot(texture(u_texture, v_uv + vec2(0.0, -px.y)).rgb, vec3(0.299, 0.587, 0.114));
    float lB = dot(texture(u_texture, v_uv + vec2(0.0,  px.y)).rgb, vec3(0.299, 0.587, 0.114));
    d = clamp(length(vec2(lR - lL, lB - lT)) * 4.0, 0.0, 1.0);
  } else {
    // flat — uniform offset
    d = 1.0;
  }

  // offset centered around focus point (focus inverted: high focus = less offset)
  float offset = (d - (1.0 - u_focus)) * u_depth;
  float rad = u_angle * 3.14159265 / 180.0;
  vec2 dir = vec2(cos(rad), sin(rad)) * offset * px;

  if (u_mode == 0) {
    // anaglyph red/cyan
    float r = texture(u_texture, v_uv + dir).r;
    vec2 gb = texture(u_texture, v_uv - dir).gb;
    outColor = vec4(r, gb, c.a);
  } else {
    // color split — offset per channel in 3 directions
    float r = texture(u_texture, v_uv + dir).r;
    float g = texture(u_texture, v_uv).g;
    float b = texture(u_texture, v_uv - dir).b;
    outColor = vec4(r, g, b, c.a);
  }
}`,
		setUniforms: (gl, l, v) => {
			setFloat(gl, l, 'u_depth', v.depth as number);
			setFloat(gl, l, 'u_angle', v.angle as number);
			const m = v.mode as string;
			setInt(gl, l, 'u_mode', m === 'color-split' ? 1 : 0);
			const ds = v.depthSource as string;
			setInt(
				gl,
				l,
				'u_depthSource',
				ds === 'edges' ? 1 : ds === 'flat' ? 2 : 0,
			);
			setFloat(gl, l, 'u_focus', v.focus as number);
		},
	},

	'pixel-sort': {
		fragment:
			H +
			`uniform float u_threshold;
uniform float u_ceiling;
uniform float u_range;
uniform int u_direction;
uniform float u_reverse;
void main() {
  vec2 px = 1.0 / vec2(textureSize(u_texture, 0));
  vec4 c = texture(u_texture, v_uv);
  float luma = dot(c.rgb, vec3(0.299, 0.587, 0.114));
  float lo = min(u_threshold, u_ceiling);
  float hi = max(u_threshold, u_ceiling);
  float span = hi - lo;
  float norm = span > 0.001 ? (clamp(luma, lo, hi) - lo) / span : 0.0;
  float sign = (u_reverse > 0.5) ? -1.0 : 1.0;
  float disp = norm * u_range * sign;
  vec2 offset = u_direction == 0 ? vec2(disp * px.x, 0.0) : vec2(0.0, disp * px.y);
  outColor = texture(u_texture, v_uv + offset);
}`,
		setUniforms: (gl, l, v) => {
			setFloat(gl, l, 'u_threshold', v.threshold as number);
			setFloat(gl, l, 'u_ceiling', v.ceiling as number);
			setFloat(gl, l, 'u_range', v.range as number);
			setInt(gl, l, 'u_direction', v.direction === 'vertical' ? 1 : 0);
			setFloat(gl, l, 'u_reverse', v.reverse as number);
		},
	},
	smear: {
		fragment:
			H +
			BOUNCE_GLSL +
			`uniform float u_amount;
uniform float u_angle;
uniform float u_trail;

const int SMEAR_STEPS = 8;

void main() {
  // Self-displacement: the image's own red/green channels are read as a vector
  // field and the pixel is walked along it, so content flows with its own
  // colour rather than in one imposed direction. Angle turns the field.
  float rad = u_angle * 3.14159265 / 180.0;
  float ca = cos(rad);
  float sa = sin(rad);
  mat2 rot = mat2(ca, -sa, sa, ca);
  float stride = u_amount * 0.2 / float(SMEAR_STEPS);

  vec2 p = v_uv;
  vec4 acc = vec4(0.0);
  float total = 0.0;
  for (int i = 0; i < SMEAR_STEPS; i++) {
    vec4 s = texture(u_texture, vec2(bounce(p.x), bounce(p.y)));
    float t = float(i) / float(SMEAR_STEPS - 1);
    // Trail 0 keeps essentially the far end of the walk — one clean
    // displacement. Trail 1 weights the whole path evenly, which is what
    // actually reads as a smear rather than a ghost.
    float w = mix(pow(t, 16.0), 1.0, u_trail);
    acc += s * w;
    total += w;
    // Re-reading the field at each step lets the walk bend with the image
    // instead of running straight, so streaks follow contours out of an edge.
    p += rot * (s.rg - 0.5) * stride;
  }
  outColor = acc / max(total, 1e-4);
}`,
		setUniforms: floats('amount', 'angle', 'trail'),
	},

	relief: {
		fragment:
			H +
			`uniform float u_amount;
uniform float u_angle;

void main() {
  vec3 lum = vec3(0.299, 0.587, 0.114);

  float rad = u_angle * 3.14159265 / 180.0;
  vec2 dir = vec2(cos(rad), sin(rad));

  // Parallax occlusion mapping: treat luma as a height field.
  // Cast a ray descending from height=1 to 0 while stepping in dir.
  // Track prev step so we can interpolate the exact intersection —
  // this eliminates staircase artifacts and gives smooth ridges.
  const int N = 64;
  vec2  stepUV = dir * u_amount / float(N);
  float stepH  = 1.0 / float(N);

  vec2  pos      = v_uv;
  float rayH     = 1.0;
  vec2  prevPos  = v_uv;
  float prevSurfH = dot(texture(u_texture, v_uv).rgb, lum);
  vec2  hitPos   = v_uv;
  bool  found    = false;

  for (int i = 0; i < N; i++) {
    float surfH = dot(texture(u_texture, pos).rgb, lum);
    if (!found && surfH >= rayH) {
      // Linearly interpolate between prev and current step for sub-step accuracy
      float prevRayH = rayH + stepH;
      float t = (prevRayH - prevSurfH) / max((surfH - prevSurfH) - (rayH - prevRayH), 0.0001);
      hitPos = mix(prevPos, pos, clamp(t, 0.0, 1.0));
      found  = true;
    }
    prevPos   = pos;
    prevSurfH = surfH;
    pos  += stepUV;
    rayH -= stepH;
  }

  outColor = texture(u_texture, hitPos);
}`,
		setUniforms: floats('amount', 'angle'),
	},

	zoom: {
		fragment:
			H +
			BOUNCE_GLSL +
			`uniform float u_amount;
void main() {
  float scale = pow(2.0, u_amount);
  vec2 uv = (v_uv - 0.5) / scale + 0.5;
  uv = vec2(bounce(uv.x), bounce(uv.y));
  outColor = texture(u_texture, uv);
}`,
		setUniforms: floats('amount'),
	},

	'fiber-displace': {
		fragment:
			H +
			BOUNCE_GLSL +
			NOISE_GLSL +
			HUE_ROTATE_GLSL +
			`uniform float u_strength;
uniform float u_density;
uniform float u_comb;
uniform float u_angle;
uniform float u_chrome;
uniform float u_smoothness;
uniform vec2 u_resolution;

#define FIBER_TAPS 14

void main() {
  // Work in an aspect-corrected frame so the weave keeps its angle and the
  // threads stay square on non-square images.
  vec2 aspect = vec2(u_resolution.x / max(u_resolution.y, 1.0), 1.0);
  float rad = u_angle * 3.14159265 / 180.0;
  vec2 dir = vec2(sin(rad), cos(rad));   // along a thread
  vec2 nrm = vec2(dir.y, -dir.x);        // across the weave

  vec2 p = v_uv * aspect;
  float across = dot(p, nrm) * u_density;
  float along = dot(p, dir);

  // Silk: band-limited noise across the weave that also drifts down the length
  // of each thread, so a fiber's pull changes as it runs instead of holding one
  // flat value for the whole span.
  float silk = fbm(vec2(across * 0.7, along * 1.7)) * 2.0 - 1.0;

  // Shred: one constant pull per thread. The cell boundary is widened to a
  // pixel with fwidth, so cranking density dissolves the weave into a soft
  // grain instead of shattering into aliased confetti.
  float cell = floor(across);
  float aa = clamp(fwidth(across), 0.02, 1.0);
  float w0 = vnoise(vec2(cell * 1.37, along * 1.7)) * 2.0 - 1.0;
  float w1 = vnoise(vec2((cell + 1.0) * 1.37, along * 1.7)) * 2.0 - 1.0;
  float shred = mix(w0, w1, smoothstep(1.0 - aa, 1.0, fract(across)));

  float fiber = mix(shred, silk, u_smoothness);
  float disp = fiber * u_strength * 0.18;

  // Walk the pull and accumulate, so each thread reads as image drawn out along
  // its length rather than a block shifted sideways. Each channel gets its own
  // weight profile over the same taps: red rides the full pull, blue lags, so
  // the fringing costs no extra fetches.
  float d = u_chrome * 0.3;
  vec3 centers = vec3(1.0, 1.0 - d * 0.5, 1.0 - d);
  vec3 acc = vec3(0.0);
  vec3 total = vec3(0.0);
  float accA = 0.0;
  float totalA = 0.0;
  for (int i = 0; i < FIBER_TAPS; i++) {
    float t = float(i) / float(FIBER_TAPS - 1);
    vec2 uv = v_uv + dir * disp * t;
    vec4 s = texture(u_texture, vec2(bounce(uv.x), bounce(uv.y)));
    // Comb 0 keeps a narrow bump at the end of the walk -- one clean pull.
    // Comb 1 weights the whole path, which is what actually reads as a
    // combed-out fiber.
    vec3 dt = vec3(t) - centers;
    vec3 w = mix(exp(-60.0 * dt * dt), 1.0 - smoothstep(vec3(-0.08), vec3(0.08), dt), u_comb);
    acc += s.rgb * w;
    total += w;
    accA += s.a * w.g;
    totalA += w.g;
  }
  vec3 col = acc / max(total, vec3(1e-4));
  float alpha = accA / max(totalA, 1e-4);

  // Sheen: light each thread as a cylinder, so the highlight is a smooth band
  // running down the fiber the way real fabric catches light. Deriving it from
  // fwidth(fiber) instead spikes on the per-thread discontinuities and stipples
  // aliased white dots along every cell boundary.
  float xr = fract(across) * 2.0 - 1.0;      // position across one thread
  float nz = sqrt(max(1.0 - xr * xr, 0.0));  // cylinder normal, facing viewer
  float ndl = clamp(xr * -0.55 + nz * 0.84, 0.0, 1.0);

  // A thread only a pixel or two wide can't carry a tight highlight, so widen
  // and dim it as the weave goes sub-pixel rather than let it alias.
  float thin = smoothstep(0.15, 0.6, aa);
  float spec = pow(ndl, mix(24.0, 3.0, thin)) * mix(1.0, 0.55, thin);

  // Vary the glint per thread so the weave doesn't read as one even sheet.
  spec *= 0.4 + 0.6 * abs(fiber);

  // Iridescence shifts with the angle you view the thread at, like an oil film,
  // and stays inside a narrow arc so neighbouring threads keep a family
  // resemblance. Swinging 110 degrees off a per-thread random instead scatters
  // them across the whole hue wheel, which is what reads as neon plastic.
  float shift = (xr * 0.75 + fiber * 0.25) * 24.0;
  col = hueRotate(col, shift * u_chrome);

  // The sheen carries no colour of its own: it scales the thread's existing
  // colour, so a lit fiber keeps its hue and saturation and simply gets more
  // light. Blending toward white instead washes the whole weave out to pastel.
  float sh = clamp(spec * u_chrome, 0.0, 1.0);
  col *= 1.0 + sh * 1.6;
  col *= 1.0 - u_chrome * 0.22 * (1.0 - nz) * (1.0 - thin);

  // Roll off on the brightest channel. A per-channel clamp would pin the other
  // two below it and desaturate the peaks to white -- the thing we just avoided.
  float peak = max(max(col.r, col.g), col.b);
  col /= 1.0 + max(peak - 1.0, 0.0);

  // Ease the threads that ended up on the gamut edge back off it. Saturation
  // pinned at full is the other half of the plastic look, and the multiply
  // above pushes colours there; only the worst offenders are touched.
  float lo = min(min(col.r, col.g), col.b);
  float sat = max(max(col.r, col.g), col.b) - lo;
  float grey = dot(col, vec3(0.299, 0.587, 0.114));
  col = mix(col, vec3(grey), smoothstep(0.6, 1.0, sat) * 0.3 * u_chrome);

  outColor = vec4(clamp(col, 0.0, 1.0), alpha);
}`,
		linearFilter: true,
		setUniforms: floats('strength', 'density', 'comb', 'angle', 'chrome', 'smoothness'),
	},

	'liquid-light': {
		fragment:
			H +
			NOISE_GLSL +
			HUE_ROTATE_GLSL +
			`uniform float u_scale;
uniform float u_flow;
uniform float u_refraction;
uniform float u_dispersion;
uniform float u_delta;
uniform vec2 u_resolution;
uniform sampler2D u_feedback;
void main() {
  vec2 aspect = vec2(u_resolution.x / max(u_resolution.y, 1.0), 1.0);
  float t = u_time * (0.04 + u_flow * 0.5);
  float freq = 1.0 + (1.0 - u_scale) * 11.0;
  vec2 p = v_uv * aspect * freq;

  // Domain warp: a slow vector field steers the cell field, so blobs creep and
  // merge like oil on water instead of boiling in place.
  vec2 w = 2.2 * vec2(fbm(p + vec2(0.0, t)), fbm(p + vec2(5.2, 1.3) - t * 0.6));

  // Field + gradient. The offset samples reuse the same warp, so the surface
  // normal costs two extra noise lookups instead of six.
  vec2 e = (2.0 / u_resolution) * aspect * freq;
  float f = fbm(p + w);
  vec2 grad = vec2(fbm(p + w + vec2(e.x, 0.0)) - f, fbm(p + w + vec2(0.0, e.y)) - f);
  float slope = length(grad);
  vec2 n = grad / max(slope, 1e-4);

  // Refract through the cell surface, one sample per channel at slightly
  // different strengths: every blob edge blooms into a wet spectral rim.
  vec2 dir = n * min(slope * 16.0, 1.0) * u_refraction * 0.3;
  float d = u_dispersion * 0.7;
  vec3 fresh;
  fresh.r = texture(u_texture, clamp(v_uv - dir * (1.0 + d), vec2(0.0), vec2(1.0))).r;
  fresh.g = texture(u_texture, clamp(v_uv - dir, vec2(0.0), vec2(1.0))).g;
  fresh.b = texture(u_texture, clamp(v_uv - dir * (1.0 - d), vec2(0.0), vec2(1.0))).b;
  float freshA = max(texture(u_texture, clamp(v_uv - dir * (1.0 + d), vec2(0.0), vec2(1.0))).a,
                     texture(u_texture, clamp(v_uv - dir * (1.0 - d), vec2(0.0), vec2(1.0))).a);

  // Thin-film iridescence riding the field value, strongest on the rims.
  float rim = min(slope * 24.0, 1.0);
  fresh = mix(fresh, hueRotate(fresh, f * 220.0 + t * 40.0), rim * u_dispersion);

  // Dye drifts along the field (perpendicular to the gradient) and heals back
  // to the live input, so the wash never buries the source.
  vec2 from = clamp(v_uv - vec2(-n.y, n.x) * u_delta * u_flow * 0.05, vec2(0.0), vec2(1.0));
  vec4 prevS = texture(u_feedback, from);
  float heal = 1.0 - exp(-mix(6.0, 1.2, u_flow) * u_delta);
  outColor = vec4(clamp(mix(prevS.rgb, fresh, heal), 0.0, 1.0),
                  clamp(mix(prevS.a, freshA, heal), 0.0, 1.0));
}`,
		animated: true,
		linearFilter: true,
		setUniforms: floats('scale', 'flow', 'refraction', 'dispersion'),
	},

	petri: {
		fragment:
			H +
			HASH_GLSL +
			`uniform float u_reaction;
uniform float u_drift;
uniform float u_scale;
uniform float u_takeover;
uniform float u_delta;
uniform vec2 u_resolution;
uniform sampler2D u_feedback;
void main() {
  // Three reagents held in RGB, so the simulation state is the visible image.
  // Each cell reacts against the local average of its neighbours -- that
  // spatial coupling is what rolls the spiral waves outward.
  vec2 px = (1.0 + u_scale * 3.0) / u_resolution;
  vec3 avg = vec3(0.0);
  float avgA = 0.0;
  for (int y = -1; y <= 1; y++) {
    for (int x = -1; x <= 1; x++) {
      vec2 uv = clamp(v_uv + vec2(float(x), float(y)) * px, vec2(0.0), vec2(1.0));
      avg += texture(u_feedback, uv).rgb;
      avgA += texture(u_feedback, uv).a;
    }
  }
  avg /= 9.0;
  avgA /= 9.0;

  // Each reagent drifts along its own heading, 120 degrees apart and slowly
  // rotating, so they chase one another across the frame instead of settling.
  // This is pure transport -- it curls the waves without producing reagent,
  // so it can't tint anything.
  float curl = (u_drift - 0.5) * 2.0;
  float a = u_time * 0.15;
  float reach = 2.5 * curl;
  vec3 drift;
  drift.r = texture(u_feedback, clamp(v_uv + vec2(cos(a), sin(a)) * px * reach, vec2(0.0), vec2(1.0))).r;
  drift.g = texture(u_feedback, clamp(v_uv + vec2(cos(a + 2.0944), sin(a + 2.0944)) * px * reach, vec2(0.0), vec2(1.0))).g;
  drift.b = texture(u_feedback, clamp(v_uv + vec2(cos(a + 4.1888), sin(a + 4.1888)) * px * reach, vec2(0.0), vec2(1.0))).b;
  avg = mix(avg, drift, 0.6 * abs(curl));

  // Cyclic reaction: red eats green eats blue eats red. The three increments
  // sum to exactly zero, so total concentration is conserved and no reagent
  // can win globally -- that is what keeps the frame from drifting into a flat
  // colour cast, however far the knobs are pushed.
  float k = clamp(u_delta * 60.0, 0.4, 2.0) * (0.4 + u_reaction * 1.6);
  vec3 next;
  next.r = avg.r + avg.r * (avg.g - avg.b) * k;
  next.g = avg.g + avg.g * (avg.b - avg.r) * k;
  next.b = avg.b + avg.b * (avg.r - avg.g) * k;

  // A whisper of noise nucleates the spirals and keeps flat regions from
  // locking into a dead uniform state, which is where this stalls on stills.
  next += (hash(v_uv * u_resolution + fract(u_time)) - 0.5) * 0.004;
  next = clamp(next, 0.0, 1.0);

  // The picture is fed back in as reagent concentration, so the chemistry
  // grows out of the image's own colours. Low takeover heals fast (picture
  // legible, faint structure); high takeover lets the reaction run away.
  vec4 srcS = texture(u_texture, v_uv);
  vec3 src = srcS.rgb;
  float seed = 1.0 - exp(-mix(7.0, 0.22, u_takeover) * u_delta);
  outColor = vec4(clamp(mix(next, src, seed), 0.0, 1.0),
                  clamp(mix(avgA, srcS.a, seed), 0.0, 1.0));
}`,
		animated: true,
		hdrFeedback: true,
		setUniforms: floats('reaction', 'drift', 'scale', 'takeover'),
	},

	'flow-contours': {
		fragment:
			H +
			HUE_ROTATE_GLSL +
			`uniform float u_bands;
uniform float u_flow;
uniform float u_cycle;
uniform float u_sheen;
uniform float u_delta;
uniform vec2 u_resolution;
uniform sampler2D u_feedback;
void main() {
  vec2 px = 1.0 / u_resolution;
  vec3 lumW = vec3(0.299, 0.587, 0.114);
  vec3 src = texture(u_texture, v_uv).rgb;
  float l = dot(src, lumW);

  // Luminance gradient: contour lines run perpendicular to it.
  float lx = dot(texture(u_texture, clamp(v_uv + vec2(px.x, 0.0), vec2(0.0), vec2(1.0))).rgb, lumW);
  float ly = dot(texture(u_texture, clamp(v_uv + vec2(0.0, px.y), vec2(0.0), vec2(1.0))).rgb, lumW);
  vec2 grad = vec2(lx - l, ly - l);
  float slope = length(grad);

  float bands = max(2.0, floor(u_bands));
  float band = floor(l * bands);

  // Neighbouring bands slide in opposite directions along the terrain
  // gradient, so the contours shear against each other rather than
  // translating as one sheet.
  float dirSign = mod(band, 2.0) * 2.0 - 1.0;
  vec2 flow = (grad / max(slope, 1e-4)) * dirSign * u_flow * u_delta * 0.2;
  vec4 prevS = texture(u_feedback, clamp(v_uv - flow, vec2(0.0), vec2(1.0)));
  vec3 prev = prevS.rgb;

  // Quantise luminance while keeping the source chroma, then cycle hue per
  // band so the terrain reads as a heat map that has gone liquid.
  vec3 quant = src * ((band + 0.5) / bands) / max(l, 0.02);
  float q = band / bands;
  quant = clamp(hueRotate(clamp(quant, 0.0, 1.0), (q * 360.0 + u_time * 50.0) * u_cycle), 0.0, 1.0);

  // Contour seam. fwidth gives the width the band edge actually occupies on
  // screen, so the line stays a couple of pixels thick at any band count
  // instead of flaring into a halo that swallows the frame.
  float terrain = l * bands;
  float w = max(fwidth(terrain), 1e-4);
  float edge = fract(terrain);
  float seam = 1.0 - smoothstep(w, w * 2.5, min(edge, 1.0 - edge));
  seam *= smoothstep(0.0, 0.6, slope * bands * 6.0);

  // Light the seam from a fixed direction so ridges facing the light catch it
  // and the rest stay dark -- an even seam just reads as white paint.
  vec2 n = grad / max(slope, 1e-4);
  float lambert = 0.25 + 0.75 * clamp(dot(n, vec2(-0.6, 0.8)), 0.0, 1.0);

  // Screen-blend a tinted highlight into the band colour instead of adding
  // white, and do it before the feedback mix: added afterwards it lands in the
  // feedback buffer and compounds every frame until the frame is flat white.
  vec3 spec = mix(quant, vec3(1.0), 0.45);
  float s = clamp(seam * lambert * u_sheen, 0.0, 1.0);
  vec3 lit = 1.0 - (1.0 - quant) * (1.0 - spec * s);

  float blend = 1.0 - exp(-mix(9.0, 1.5, u_flow) * u_delta);
  vec3 col = mix(prev, lit, blend);
  float colA = mix(prevS.a, texture(u_texture, v_uv).a, blend);

  outColor = vec4(clamp(col, 0.0, 1.0), clamp(colA, 0.0, 1.0));
}`,
		animated: true,
		setUniforms: floats('bands', 'flow', 'cycle', 'sheen'),
	},
};

export const ANIMATED_EFFECTS = new Set(
	Object.entries(EFFECT_SHADERS)
		.filter(([, def]) => def.animated)
		.map(([id]) => id),
);
// Tracking is a 2D-canvas overlay (no shader) but animates every frame
// (jitter / glitch-jumps / data scramble), so the render loop must keep running.
ANIMATED_EFFECTS.add('tracking');

/** Effects that paint their own background, so they can't sit on a text layer
 * without filling the frame. The text panel warns before one is added. */
export const OPAQUE_OUTPUT_EFFECTS = new Set(
	Object.entries(EFFECT_SHADERS)
		.filter(([, def]) => def.opaqueOutput)
		.map(([id]) => id),
);
