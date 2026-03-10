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
  outColor = vec4(clamp(blended, 0.0, 1.0), 1.0);
}`;

export interface EffectShaderDef {
	fragment: string;
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

/** Create a setUniforms that maps each key to a float uniform named u_{key}. */
function floats(...keys: string[]): EffectShaderDef['setUniforms'] {
	return (gl, l, v) => {
		for (const key of keys) setFloat(gl, l, `u_${key}`, v[key] as number);
	};
}

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
			`uniform float u_threshold;
void main() {
  vec4 c = texture(u_texture, v_uv);
  outColor = vec4(mix(c.rgb, 1.0 - c.rgb, step(u_threshold, c.rgb)), c.a);
}`,
		setUniforms: floats('threshold'),
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
			`uniform float u_strength;
uniform float u_glow;
uniform float u_bg;

vec3 rgb2hsv(vec3 c) {
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
    float t = u_time;
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
    vec3 color = vec3(r, g, b);
    float hueShift = pos * u_amount * 0.1 + t * 0.2;
    float cosH = cos(hueShift);
    float sinH = sin(hueShift);
    vec3 k = vec3(0.57735);
    vec3 rotated = color * cosH + cross(k, color) * sinH + k * dot(k, color) * (1.0 - cosH);
    color = mix(color, rotated, u_saturation);
    outColor = vec4(color, 1.0);
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
  vec3 rgb = c.rgb + u_brightness;
  rgb = (rgb - 0.5) * (1.0 + u_contrast) + 0.5;
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
void main() {
  vec4 c = texture(u_texture, v_uv);
  float dist = length(v_uv - 0.5);
  float radius = 1.0 - u_size;
  float vig = smoothstep(radius, radius - 0.45, dist);
  outColor = vec4(c.rgb * mix(1.0, vig, u_amount), c.a);
}`,
		setUniforms: floats('size', 'amount'),
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
uniform float u_seed;
float hash(vec2 p) {
  return fract(sin(dot(p, vec2(12.9898, 78.233))) * 43758.5453);
}
void main() {
  vec2 px = 1.0 / vec2(textureSize(u_texture, 0));
  float t = floor(u_time * 15.0);
  vec2 off = vec2(
    hash(vec2(floor(v_uv.y * 500.0), u_seed + t)) - 0.5,
    hash(vec2(floor(v_uv.x * 500.0), u_seed + t + 1.0)) - 0.5
  ) * u_amount * px;
  outColor = texture(u_texture, v_uv + off);
}`,
		animated: true,
		setUniforms: floats('amount', 'seed'),
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
float hash(float n) { return fract(sin(n * 12.9898) * 43758.5453); }
void main() {
  vec2 px = 1.0 / vec2(textureSize(u_texture, 0));
  float t = floor(u_time * 20.0);
  vec2 off = vec2(
    (hash(t) - 0.5) * 2.0,
    (hash(t + 7.0) - 0.5) * 2.0
  ) * u_amount * px;
  outColor = texture(u_texture, v_uv + off);
}`,
		animated: true,
		setUniforms: floats('amount'),
	},

	glow: {
		fragment:
			H +
			`uniform float u_amount;
uniform float u_cutoff;
uniform float u_radius;
void main() {
  vec4 c = texture(u_texture, v_uv);
  vec2 px = 1.0 / vec2(textureSize(u_texture, 0));
  vec3 glow = vec3(0.0);
  float totalWeight = 0.0;
  float falloff = 1.0 / max(u_radius * u_radius, 0.001);
  const int R = 2;
  for (int x = -R; x <= R; x++) {
    for (int y = -R; y <= R; y++) {
      float distSq = float(x * x + y * y);
      float w = exp(-distSq * falloff);
      vec2 off = vec2(float(x), float(y)) * px * u_radius;
      vec3 s = texture(u_texture, v_uv + off).rgb;
      float luma = dot(s, vec3(0.299, 0.587, 0.114));
      glow += vec3(max(0.0, luma - u_cutoff)) * w;
      totalWeight += w;
    }
  }
  glow /= totalWeight;
  outColor = vec4(c.rgb + glow * u_amount, c.a);
}`,
		setUniforms: floats('amount', 'cutoff', 'radius'),
	},

	'soft-glitch': {
		fragment:
			H +
			`uniform float u_amount;
float hash(vec2 p) {
  return fract(sin(dot(p, vec2(12.9898, 78.233))) * 43758.5453);
}
void main() {
  vec2 px = 1.0 / vec2(textureSize(u_texture, 0));
  float t = floor(u_time * 6.0);
  float y = v_uv.y;

  float bandW = mix(15.0, 60.0, hash(vec2(t, 3.0)));
  float band = floor(y * bandW);
  float noise = mix(
    hash(vec2(band, t)),
    hash(vec2(band + 1.0, t)),
    fract(y * bandW)
  );
  float burst = step(0.85, hash(vec2(band * 0.3, t))) * 3.0 + 1.0;
  float off = (noise - 0.5) * u_amount * px.x * burst;

  float vertJitter = (hash(vec2(band, t + 5.0)) - 0.5) * u_amount * px.y * 0.3;
  vec2 base = v_uv + vec2(0.0, vertJitter);

  outColor = vec4(
    texture(u_texture, base + vec2(off * 1.5, 0.0)).r,
    texture(u_texture, base + vec2(-off * 0.4, vertJitter * 0.5)).g,
    texture(u_texture, base - vec2(off * 1.5, 0.0)).b,
    1.0
  );
}`,
		animated: true,
		setUniforms: floats('amount'),
	},

	'hard-glitch': {
		fragment:
			H +
			`uniform float u_amount;
uniform float u_scale;
float hash(float n) { return fract(sin(n) * 43758.5453); }
float hash2(vec2 p) { return fract(sin(dot(p, vec2(12.9898, 78.233))) * 43758.5453); }
void main() {
  vec2 px = 1.0 / vec2(textureSize(u_texture, 0));
  float t = floor(u_time * 10.0);

  float rowH = mix(5.0, 30.0, u_scale);
  float blockY = floor(v_uv.y * rowH);
  float colW = mix(1.0, 8.0, u_scale);
  float blockX = floor(v_uv.x * colW);

  float rowTrigger = step(0.6, hash(blockY + t * 7.0));
  float blockTrigger = step(0.5, hash2(vec2(blockX, blockY + t)));
  float trigger = max(rowTrigger, rowTrigger * blockTrigger);

  float rowOff = (hash(blockY * 3.0 + t) - 0.5) * 2.0;
  float blockOff = (hash2(vec2(blockX, blockY + t * 2.0)) - 0.5);
  float off = mix(rowOff, blockOff, 0.4) * u_amount * trigger * px.x;

  float flicker = step(0.92, hash(t + 0.5));
  off += flicker * (hash(t * 3.0) - 0.5) * u_amount * 3.0 * px.x;

  vec2 d = v_uv + vec2(off, 0.0);
  float split = off * 0.4;
  outColor = vec4(
    texture(u_texture, d + vec2(split, 0.0)).r,
    texture(u_texture, d).g,
    texture(u_texture, d - vec2(split, 0.0)).b,
    1.0
  );
  outColor.rgb = mix(outColor.rgb, vec3(outColor.r), flicker * 0.5);
}`,
		animated: true,
		setUniforms: floats('amount', 'scale'),
	},

	'optical-flow': {
		fragment:
			H +
			`uniform sampler2D u_feedback;
uniform float u_amount;
uniform float u_distortion;
void main() {
  vec2 px = 1.0 / vec2(textureSize(u_texture, 0));
  float r = 2.0 + u_distortion * 6.0; // sampling radius: 2–8 pixels
  vec2 step_ = px * r;

  // Spatial gradient (Sobel-like, wider sampling)
  float lL = dot(texture(u_texture, v_uv - vec2(step_.x, 0.0)).rgb, vec3(0.299, 0.587, 0.114));
  float lR = dot(texture(u_texture, v_uv + vec2(step_.x, 0.0)).rgb, vec3(0.299, 0.587, 0.114));
  float lT = dot(texture(u_texture, v_uv - vec2(0.0, step_.y)).rgb, vec3(0.299, 0.587, 0.114));
  float lB = dot(texture(u_texture, v_uv + vec2(0.0, step_.y)).rgb, vec3(0.299, 0.587, 0.114));

  // Temporal difference from feedback
  float lumCur  = dot(texture(u_texture,  v_uv).rgb, vec3(0.299, 0.587, 0.114));
  float lumPrev = dot(texture(u_feedback, v_uv).rgb, vec3(0.299, 0.587, 0.114));
  float dt = lumCur - lumPrev;

  vec2 grad = vec2(lR - lL, lB - lT);
  float gradSq = dot(grad, grad) + 0.001;

  // Lucas-Kanade style: flow = -(Ix*It, Iy*It) / (Ix²+Iy²)
  vec2 flow = -grad * dt / gradSq;
  flow *= u_amount * 200.0 * px;

  outColor = texture(u_texture, v_uv + flow);
}`,
		animated: true,
		setUniforms: floats('amount', 'distortion'),
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
  vec2 px = 1.0 / vec2(textureSize(u_texture, 0));
  vec2 res = vec2(textureSize(u_texture, 0));
  float t = u_time;
  float row = floor(v_uv.y * res.y);
  float tFrame = floor(t * 30.0);

  // --- Drifting hotspot regions where static concentrates ---
  float hotspot = 0.5
    + 0.3 * sin(v_uv.y * 6.0 + t * 0.5)
    + 0.2 * sin(v_uv.y * 17.0 - t * 0.8);
  hotspot = clamp(hotspot, 0.0, 1.0);

  // --- Static bands: 2-5px tall, not single pixel rows ---
  float bandH = 2.0 + hash(vec2(floor(row / 3.0), 444.0)) * 3.0;
  float bandId = floor(row / bandH);

  // Each band has a random lifetime (2-8 frames) before it changes
  float lifeLen = 2.0 + floor(hash(vec2(bandId, 123.0)) * 7.0);
  // Quantize frame time by this band's lifetime
  float bandEpoch = floor(tFrame / lifeLen);

  float bandChance = hash(vec2(bandId, bandEpoch * 7.0));
  float isStaticBand = step(1.0 - u_noise * 0.5 * hotspot, bandChance);

  // --- Displacement: horizontal shift for static bands ---
  float shiftDir = hash(vec2(bandId, bandEpoch * 13.0 + 50.0)) - 0.5;
  float shiftAmt = isStaticBand * shiftDir * u_noise * 40.0 * px.x;

  // --- White streak overlay on static bands ---
  float streakX0 = hash(vec2(bandId * 3.0, bandEpoch + 77.0));
  float lenSeed = hash(vec2(bandId * 7.0, bandEpoch + 33.0));
  // Mostly short (2-15% width), some medium, rare long
  float streakLen = 0.02 + lenSeed * 0.13;
  streakLen += step(0.8, lenSeed) * 0.1;
  float inStreak = isStaticBand
    * step(streakX0, v_uv.x) * step(v_uv.x, streakX0 + streakLen);
  float streakBright = inStreak * (0.5 + hash(vec2(bandId, bandEpoch * 3.0)) * 0.5) * u_noise;

  // --- Subtle per-line jitter on non-static rows too ---
  float scanY = floor(v_uv.y * 480.0);
  float lineNoise = (hash(vec2(scanY, floor(t * 10.0))) - 0.5) * u_noise * 4.0 * px.x;

  // --- Warp bands (larger sporadic displacement) ---
  float warpA = (hash(vec2(floor(v_uv.y * 80.0), floor(t * 6.0))) - 0.5)
    * step(0.75, hash(vec2(floor(v_uv.y * 80.0) + 100.0, floor(t * 6.0))))
    * u_noise * 15.0 * px.x;
  float warpB = (hash(vec2(floor(v_uv.y * 200.0), floor(t * 8.0))) - 0.5)
    * step(0.82, hash(vec2(floor(v_uv.y * 200.0) + 50.0, floor(t * 8.0))))
    * u_noise * 6.0 * px.x;

  float totalWarp = lineNoise + warpA + warpB + shiftAmt;
  float rOff = totalWarp * 1.2;
  float bOff = totalWarp * -0.8;

  // --- Multiple tracking bars ---
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

  rOff += bars * 25.0 * px.x;
  bOff -= bars * 18.0 * px.x;

  // --- Sample with RGB split ---
  vec4 c;
  c.r = texture(u_texture, v_uv + vec2(rOff, 0.0)).r;
  c.g = texture(u_texture, v_uv + vec2(totalWarp * 0.3, 0.0)).g;
  c.b = texture(u_texture, v_uv + vec2(bOff, 0.0)).b;
  c.a = 1.0;

  // --- Overlay white streaks + bar brightness ---
  c.rgb += streakBright;
  c.rgb += bars * 0.12;

  outColor = c;
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
			`uniform float u_shadowHue;
uniform float u_highlightHue;
uniform float u_intensity;
vec3 hsl2rgb(float h) {
  float hr = h / 60.0;
  float x = 1.0 - abs(mod(hr, 2.0) - 1.0);
  vec3 c;
  if (hr < 1.0) c = vec3(1.0, x, 0.0);
  else if (hr < 2.0) c = vec3(x, 1.0, 0.0);
  else if (hr < 3.0) c = vec3(0.0, 1.0, x);
  else if (hr < 4.0) c = vec3(0.0, x, 1.0);
  else if (hr < 5.0) c = vec3(x, 0.0, 1.0);
  else c = vec3(1.0, 0.0, x);
  return c;
}
void main() {
  vec4 c = texture(u_texture, v_uv);
  float luma = dot(c.rgb, vec3(0.299, 0.587, 0.114));
  vec3 shadow = hsl2rgb(u_shadowHue) * 0.3;
  vec3 highlight = hsl2rgb(u_highlightHue);
  vec3 duo = mix(shadow, highlight, luma);
  outColor = vec4(mix(c.rgb, duo, u_intensity), c.a);
}`,
		setUniforms: floats('shadowHue', 'highlightHue', 'intensity'),
	},

	grain: {
		fragment:
			H +
			`uniform float u_amount;
uniform float u_rgb;
uniform int u_blendMode;
uint ihash(uint x) {
  x ^= x >> 16u;
  x *= 0x45d9f3bu;
  x ^= x >> 16u;
  x *= 0x45d9f3bu;
  x ^= x >> 16u;
  return x;
}
float noise(uvec3 v) {
  return float(ihash(v.x ^ ihash(v.y ^ ihash(v.z)))) / float(0xffffffffu);
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
  ivec2 px = ivec2(gl_FragCoord.xy);
  uint frame = uint(floor(u_time * 24.0));
  float n = noise(uvec3(uint(px.x), uint(px.y), frame));
  vec3 grain = u_rgb > 0.5
    ? vec3(n, noise(uvec3(uint(px.x), uint(px.y), frame + 1000u)),
               noise(uvec3(uint(px.x), uint(px.y), frame + 2000u)))
    : vec3(n);
  vec3 result;
  if (u_blendMode == 0) {
    result = mix(c.rgb, blendSoftLight(c.rgb, grain), u_amount);
  } else if (u_blendMode == 1) {
    result = c.rgb + (grain - 0.5) * u_amount;
  } else {
    result = c.rgb * mix(vec3(1.0), grain, u_amount);
  }
  outColor = vec4(clamp(result, 0.0, 1.0), c.a);
}`,
		animated: true,
		setUniforms: (gl, l, v) => {
			setFloat(gl, l, 'u_amount', v.amount as number);
			setFloat(gl, l, 'u_rgb', v.rgb as number);
			const mode =
				v.blendMode === 'additive' ? 1 : v.blendMode === 'multiply' ? 2 : 0;
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
  vec2 uv = rotated * u_size + u_offset;
  vec2 cell = floor(uv);
  vec2 local = fract(uv);
  vec2 mirrored = mix(local, 1.0 - local, mod(cell, 2.0));
  outColor = texture(u_texture, mirrored);
}`,
		setUniforms: floats('size', 'offset', 'angle'),
	},

	'color-melt': {
		fragment:
			H +
			`uniform float u_intensity;
void main() {
  float t = u_time;
  vec2 px = 1.0 / vec2(textureSize(u_texture, 0));
  float rOff = sin(v_uv.y * 12.0 + t * 1.3) + sin(v_uv.y * 23.0 - t * 0.7);
  float gOff = sin(v_uv.y * 8.0 + t * 0.9 + 2.094) + cos(v_uv.y * 17.0 + t * 1.1);
  float bOff = sin(v_uv.y * 15.0 + t * 1.7 + 4.189) + sin(v_uv.y * 31.0 + t * 0.5);
  outColor = vec4(
    texture(u_texture, v_uv + vec2(rOff * u_intensity * px.x, 0.0)).r,
    texture(u_texture, v_uv + vec2(gOff * u_intensity * px.x, 0.0)).g,
    texture(u_texture, v_uv + vec2(bOff * u_intensity * px.x, 0.0)).b,
    1.0
  );
}`,
		animated: true,
		setUniforms: floats('intensity'),
	},

	'data-bend': {
		fragment:
			H +
			`uniform float u_intensity;
uniform float u_threshold;
uniform float u_chunkSize;
float hash(vec2 p) {
  return fract(sin(dot(p, vec2(12.9898, 78.233))) * 43758.5453);
}
void main() {
  float t = floor(u_time * 6.0);
  vec2 px = 1.0 / vec2(textureSize(u_texture, 0));
  float chunks = 105.0 - u_chunkSize;
  float row = floor(v_uv.y * chunks);
  float rowHash = hash(vec2(row, t));
  float trigger = step(1.0 - u_threshold, rowHash);
  float strength = (hash(vec2(row * 3.0, t + 1.0)) - 0.5) * 2.0;
  float burst = 1.0 + step(0.85, hash(vec2(row * 7.0, t))) * 3.0;
  float offset = strength * u_intensity * trigger * burst * px.x;
  outColor = vec4(
    texture(u_texture, v_uv + vec2(offset * 1.3, 0.0)).r,
    texture(u_texture, v_uv + vec2(offset * -0.5, 0.0)).g,
    texture(u_texture, v_uv + vec2(offset * -0.9, 0.0)).b,
    1.0
  );
}`,
		animated: true,
		setUniforms: floats('intensity', 'threshold', 'chunkSize'),
	},

	melt: {
		fragment:
			H +
			`uniform float u_amount;
float hash(vec2 p) {
  return fract(sin(dot(p, vec2(12.9898, 78.233))) * 43758.5453);
}
void main() {
  vec2 ts = vec2(textureSize(u_texture, 0));
  float t = u_time;
  float col = floor(v_uv.x * ts.x);
  float colHash = hash(vec2(col, 0.0));
  float fineHash = hash(vec2(col * 3.0, 7.0));
  vec4 orig = texture(u_texture, v_uv);
  float brightness = dot(orig.rgb, vec3(0.299, 0.587, 0.114));
  float yFactor = v_uv.y;
  float timeWave = 0.5 + 0.5 * sin(t * 2.0 + colHash * 6.28318);
  float displacement = u_amount * yFactor * brightness * (colHash * 0.6 + fineHash * 0.4) * timeWave;
  vec2 uv = v_uv - vec2(0.0, displacement * 0.25);
  float chromatic = displacement * 0.02;
  outColor = vec4(
    texture(u_texture, uv + vec2(chromatic, 0.0)).r,
    texture(u_texture, uv).g,
    texture(u_texture, uv - vec2(chromatic, 0.0)).b,
    1.0
  );
}`,
		animated: true,
		setUniforms: floats('amount'),
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

	shatter: {
		fragment:
			H +
			`uniform float u_intensity;
uniform float u_cells;
uniform float u_rgbSplit;
uniform float u_chaos;
uniform float u_outline;

// smooth 2D value noise
vec2 hash2(vec2 p) {
  p = vec2(dot(p, vec2(127.1, 311.7)), dot(p, vec2(269.5, 183.3)));
  return fract(sin(p) * 43758.5453);
}

float hash1(vec2 p) {
  return fract(sin(dot(p, vec2(12.9898, 78.233))) * 43758.5453);
}

// smooth noise for UV warping — bicubic interpolated value noise
vec2 noise2(vec2 p) {
  vec2 i = floor(p);
  vec2 f = fract(p);
  vec2 u = f * f * (3.0 - 2.0 * f); // smoothstep
  vec2 a = hash2(i);
  vec2 b = hash2(i + vec2(1.0, 0.0));
  vec2 c = hash2(i + vec2(0.0, 1.0));
  vec2 d = hash2(i + vec2(1.0, 1.0));
  return mix(mix(a, b, u.x), mix(c, d, u.x), u.y) - 0.5;
}

// layered non-repeating warp field
vec2 warpField(vec2 uv, float t) {
  vec2 w = vec2(0.0);
  // layer 1 — large slow movement
  w += noise2(uv * 2.1 + t * vec2(0.13, 0.17)) * 0.5;
  // layer 2 — medium drift at irrational speed ratio
  w += noise2(uv * 4.3 + t * vec2(0.21, -0.16) + 31.7) * 0.25;
  // layer 3 — fine detail, different direction
  w += noise2(uv * 7.7 + t * vec2(-0.11, 0.23) + 73.1) * 0.125;
  return w;
}

// standard voronoi — points stay centered, no wandering
vec4 voronoi(vec2 uv, float cells) {
  vec2 scaled = uv * cells;
  vec2 iuv = floor(scaled);
  vec2 fuv = fract(scaled);

  float minD = 1e9;
  float minD2 = 1e9;
  vec2 nearestCell = vec2(0.0);

  for (int y = -1; y <= 1; y++) {
    for (int x = -1; x <= 1; x++) {
      vec2 neighbor = vec2(float(x), float(y));
      vec2 cellId = iuv + neighbor;
      vec2 point = hash2(cellId); // fixed point per cell
      vec2 diff = neighbor + point - fuv;
      float d = dot(diff, diff);

      if (d < minD) {
        minD2 = minD;
        minD = d;
        nearestCell = cellId;
      } else if (d < minD2) {
        minD2 = d;
      }
    }
  }

  return vec4(sqrt(minD), sqrt(minD2), nearestCell);
}

void main() {
  float t = u_time;

  // warp UV space — this is what makes cells organically morph
  vec2 warp = warpField(v_uv, t) * u_intensity;
  vec2 warpedUV = v_uv + warp;

  vec4 vor = voronoi(warpedUV, u_cells);
  float minD = vor.x;
  float minD2 = vor.y;

  // per-cell identity from cell coords
  float cellHash = hash1(vor.zw);
  float h1 = cellHash;
  float h2 = fract(cellHash * 127.1);
  float h3 = fract(cellHash * 269.5);

  float trigger = step(1.0 - u_chaos, h1);

  // per-cell displacement — shards show different parts of the image
  vec2 cellDisp = (vec2(h2, h3) - 0.5) * 2.0 * u_intensity * 0.15 * trigger;
  vec2 sampleUV = v_uv + cellDisp;

  // RGB split per cell
  float split = u_rgbSplit * u_intensity * trigger * 0.04;
  vec2 splitDir = normalize(vec2(h2 - 0.5, h3 - 0.5) + 1e-4);
  vec2 splitOff = splitDir * split;

  vec3 color = vec3(
    texture(u_texture, sampleUV + splitOff).r,
    texture(u_texture, sampleUV).g,
    texture(u_texture, sampleUV - splitOff).b
  );

  // outline — darken toward edges
  float outlineEdge = smoothstep(0.0, 0.12, minD2 - minD);
  color = mix(vec3(0.0), color, mix(1.0, outlineEdge, u_outline));

  outColor = vec4(color, 1.0);
}`,
		animated: true,
		setUniforms: floats('intensity', 'cells', 'rgbSplit', 'chaos', 'outline'),
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
			`uniform float u_amount;
uniform float u_angle;
uniform float u_stretch;
void main() {
  float rad = u_angle * 3.14159265 / 180.0;
  vec2 dir = vec2(cos(rad), sin(rad));
  vec2 px = 1.0 / vec2(textureSize(u_texture, 0));
  vec2 s = dir * u_stretch * 80.0 * px;
  vec4 cur = texture(u_texture, v_uv);
  float curLuma = dot(cur.rgb, vec3(0.299, 0.587, 0.114));
  vec4 trail = cur;
  const int SAMPLES = 24;
  for (int i = 1; i <= SAMPLES; i++) {
    float f = float(i) / float(SAMPLES);
    vec4 tap = texture(u_texture, v_uv - s * f);
    float tapLuma = dot(tap.rgb, vec3(0.299, 0.587, 0.114));
    float carry = smoothstep(curLuma - 0.05, curLuma + 0.2, tapLuma);
    trail = mix(trail, tap, carry * exp(-2.5 * f));
  }
  outColor = mix(cur, trail, u_amount);
}`,
		setUniforms: floats('amount', 'angle', 'stretch'),
	},
	'luma-mesh': {
		fragment:
			H +
			`uniform float u_count;
uniform float u_thickness;
uniform float u_hue;
uniform float u_opacity;

vec3 hsvToRgb(float h, float s, float v) {
  h = fract(h);
  float i = floor(h * 6.0);
  float f = h * 6.0 - i;
  float p = v * (1.0 - s);
  float q = v * (1.0 - f * s);
  float t = v * (1.0 - (1.0 - f) * s);
  if (i == 0.0) return vec3(v, t, p);
  if (i == 1.0) return vec3(q, v, p);
  if (i == 2.0) return vec3(p, v, t);
  if (i == 3.0) return vec3(p, q, v);
  if (i == 4.0) return vec3(t, p, v);
  return vec3(v, p, q);
}

void main() {
  vec4 c = texture(u_texture, v_uv);
  float luma = dot(c.rgb, vec3(0.299, 0.587, 0.114));
  float bands = luma * u_count;
  float f = fract(bands);
  float line = 1.0 - smoothstep(0.0, u_thickness, min(f, 1.0 - f));
  vec3 lineColor = hsvToRgb(u_hue / 360.0, 0.8, 1.0);
  outColor = vec4(mix(c.rgb, lineColor, line * u_opacity), c.a);
}`,
		setUniforms: floats('count', 'thickness', 'hue', 'opacity'),
	},
};

export const ANIMATED_EFFECTS = new Set(
	Object.entries(EFFECT_SHADERS)
		.filter(([, def]) => def.animated)
		.map(([id]) => id),
);
