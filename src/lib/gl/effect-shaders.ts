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

export const PASSTHROUGH_FRAG =
	H +
	`void main() {
  outColor = texture(u_texture, v_uv);
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
  vec4 c  = texture(u_texture, v_uv);
  vec4 t  = texture(u_texture, v_uv + vec2(0, -px.y));
  vec4 b  = texture(u_texture, v_uv + vec2(0,  px.y));
  vec4 le = texture(u_texture, v_uv + vec2(-px.x, 0));
  vec4 r  = texture(u_texture, v_uv + vec2( px.x, 0));
  vec3 diff = c.rgb * 4.0 - (t.rgb + b.rgb + le.rgb + r.rgb);
  vec3 mask = step(vec3(u_threshold), abs(diff));
  outColor = vec4(clamp(c.rgb + diff * u_amount * mask, 0.0, 1.0), c.a);
}`,
		setUniforms: floats('amount', 'radius', 'threshold'),
	},

	mirror: {
		fragment:
			H +
			`uniform float u_amount;
uniform int u_side;
uniform float u_position;
float bounce(float v) {
  v = mod(abs(v), 2.0);
  return v > 1.0 ? 2.0 - v : v;
}
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
			`uniform float u_amount;
uniform float u_sides;
uniform float u_angle;
float bounce(float v) {
  v = mod(abs(v), 2.0);
  return v > 1.0 ? 2.0 - v : v;
}
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

	'rgb-shift': {
		fragment:
			H +
			`uniform float u_amount;
uniform float u_angle;
void main() {
  vec2 px = 1.0 / vec2(textureSize(u_texture, 0));
  float rad = u_angle * 3.14159265 / 180.0;
  vec2 d = vec2(cos(rad), sin(rad)) * u_amount * px;
  outColor = vec4(
    texture(u_texture, v_uv + d).r,
    texture(u_texture, v_uv).g,
    texture(u_texture, v_uv - d).b,
    texture(u_texture, v_uv).a
  );
}`,
		setUniforms: floats('amount', 'angle'),
	},

	'color-correction': {
		fragment:
			H +
			`uniform float u_brightness;
uniform float u_contrast;
uniform float u_hue;
uniform float u_saturation;
vec3 hueRotate(vec3 c, float angle) {
  float rad = angle * 3.14159265 / 180.0;
  float cosA = cos(rad);
  float sinA = sin(rad);
  vec3 k = vec3(0.57735026919);
  return c * cosA + cross(k, c) * sinA + k * dot(k, c) * (1.0 - cosA);
}
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
uniform float u_speed;
float hash(vec2 p) {
  return fract(sin(dot(p, vec2(12.9898, 78.233))) * 43758.5453);
}
void main() {
  vec2 px = 1.0 / vec2(textureSize(u_texture, 0));
  float t = floor(u_time * 15.0 * u_speed);
  vec2 off = vec2(
    hash(vec2(floor(v_uv.y * 500.0), u_seed + t)) - 0.5,
    hash(vec2(floor(v_uv.x * 500.0), u_seed + t + 1.0)) - 0.5
  ) * u_amount * px;
  outColor = texture(u_texture, v_uv + off);
}`,
		animated: true,
		setUniforms: floats('amount', 'seed', 'speed'),
	},

	wobble: {
		fragment:
			H +
			`uniform float u_amount;
uniform float u_frequency;
void main() {
  vec2 px = 1.0 / vec2(textureSize(u_texture, 0));
  vec2 off = vec2(
    sin(v_uv.y * u_frequency * 6.28318 + u_time * 2.0) * u_amount * px.x,
    cos(v_uv.x * u_frequency * 6.28318 + u_time * 2.0) * u_amount * px.y
  );
  outColor = texture(u_texture, v_uv + off);
}`,
		animated: true,
		setUniforms: floats('amount', 'frequency'),
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
void main() {
  vec4 c = texture(u_texture, v_uv);
  vec2 px = 1.0 / vec2(textureSize(u_texture, 0));
  vec3 glow = vec3(0.0);
  const int R = 2;
  for (int x = -R; x <= R; x++) {
    for (int y = -R; y <= R; y++) {
      vec2 off = vec2(float(x), float(y)) * px * 6.0;
      vec3 s = texture(u_texture, v_uv + off).rgb;
      float b = max(s.r, max(s.g, s.b));
      glow += s * max(0.0, b - u_cutoff);
    }
  }
  glow /= float((2*R+1) * (2*R+1));
  outColor = vec4(c.rgb + glow * u_amount, c.a);
}`,
		setUniforms: floats('amount', 'cutoff'),
	},

	'soft-glitch': {
		fragment:
			H +
			`uniform float u_amount;
uniform float u_speed;
float hash(vec2 p) {
  return fract(sin(dot(p, vec2(12.9898, 78.233))) * 43758.5453);
}
void main() {
  vec2 px = 1.0 / vec2(textureSize(u_texture, 0));
  float t = floor(u_time * 6.0 * u_speed);
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
		setUniforms: floats('amount', 'speed'),
	},

	'hard-glitch': {
		fragment:
			H +
			`uniform float u_amount;
uniform float u_scale;
uniform float u_speed;
float hash(float n) { return fract(sin(n) * 43758.5453); }
float hash2(vec2 p) { return fract(sin(dot(p, vec2(12.9898, 78.233))) * 43758.5453); }
void main() {
  vec2 px = 1.0 / vec2(textureSize(u_texture, 0));
  float t = floor(u_time * 10.0 * u_speed);

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
		setUniforms: floats('amount', 'scale', 'speed'),
	},

	'optical-flow': {
		fragment:
			H +
			`uniform float u_amount;
uniform float u_distortion;
uniform float u_speed;
void main() {
  vec2 px = 1.0 / vec2(textureSize(u_texture, 0));
  float lL = dot(texture(u_texture, v_uv + vec2(-px.x, 0.0)).rgb, vec3(0.299, 0.587, 0.114));
  float lR = dot(texture(u_texture, v_uv + vec2( px.x, 0.0)).rgb, vec3(0.299, 0.587, 0.114));
  float lT = dot(texture(u_texture, v_uv + vec2(0.0, -px.y)).rgb, vec3(0.299, 0.587, 0.114));
  float lB = dot(texture(u_texture, v_uv + vec2(0.0,  px.y)).rgb, vec3(0.299, 0.587, 0.114));
  vec2 grad = vec2(lR - lL, lB - lT);
  float gradLen = length(grad);
  float phase = u_time * u_speed;
  vec2 flow = grad * u_distortion * sin(phase + gradLen * 20.0);
  vec2 offset = flow * u_amount * 100.0 * px;
  outColor = texture(u_texture, v_uv + offset);
}`,
		animated: true,
		setUniforms: floats('amount', 'distortion', 'speed'),
	},

	feedback: {
		fragment:
			H +
			`uniform sampler2D u_feedback;
uniform float u_amount;
uniform float u_scale;
uniform float u_rotate;
uniform float u_warp;
uniform float u_hueShift;
vec3 hueRotate(vec3 c, float angle) {
  float rad = angle * 3.14159265 / 180.0;
  float cosA = cos(rad);
  float sinA = sin(rad);
  vec3 k = vec3(0.57735026919);
  return c * cosA + cross(k, c) * sinA + k * dot(k, c) * (1.0 - cosA);
}
void main() {
  vec4 cur = texture(u_texture, v_uv);
  vec2 center = vec2(0.5);
  vec2 uv = v_uv - center;
  uv /= (1.0 + u_scale * 0.1);
  float a = u_rotate * 0.1;
  float cs = cos(a); float sn = sin(a);
  uv = vec2(uv.x * cs - uv.y * sn, uv.x * sn + uv.y * cs);
  float d = length(uv);
  uv *= 1.0 + d * u_warp;
  uv += center;
  vec4 fb = texture(u_feedback, uv);
  fb.rgb = hueRotate(fb.rgb, u_hueShift * 360.0);
  outColor = mix(cur, fb, u_amount);
}`,
		animated: true,
		setUniforms: floats('amount', 'scale', 'rotate', 'warp', 'hueShift'),
	},

	vhs: {
		fragment:
			H +
			`uniform float u_amount;
uniform float u_speed;
uniform float u_tracking;
float hash(vec2 p) {
  return fract(sin(dot(p, vec2(12.9898, 78.233))) * 43758.5453);
}
void main() {
  vec2 px = 1.0 / vec2(textureSize(u_texture, 0));
  float t = u_time * u_speed;
  float scanY = floor(v_uv.y * 480.0);

  float lineNoise = (hash(vec2(scanY, floor(t * 10.0))) - 0.5) * u_amount * 8.0 * px.x;

  float warpA = (hash(vec2(floor(v_uv.y * 80.0), floor(t * 6.0))) - 0.5)
    * step(0.75, hash(vec2(floor(v_uv.y * 80.0) + 100.0, floor(t * 6.0))))
    * u_amount * 15.0 * px.x;
  float warpB = (hash(vec2(floor(v_uv.y * 200.0), floor(t * 8.0))) - 0.5)
    * step(0.82, hash(vec2(floor(v_uv.y * 200.0) + 50.0, floor(t * 8.0))))
    * u_amount * 6.0 * px.x;
  float warpC = sin(v_uv.y * 120.0 + t * 4.0) * u_amount * 1.5 * px.x;

  float totalWarp = lineNoise + warpA + warpB + warpC;
  float rOff = totalWarp * 1.2;
  float bOff = totalWarp * -0.8;

  float barPos = fract(t * 0.15);
  float barDist = abs(v_uv.y - barPos);
  float bar = smoothstep(0.06, 0.0, barDist) * u_tracking;
  rOff += bar * 20.0 * px.x;
  bOff -= bar * 15.0 * px.x;

  vec4 c;
  c.r = texture(u_texture, v_uv + vec2(rOff, 0.0)).r;
  c.g = texture(u_texture, v_uv + vec2(totalWarp * 0.3, 0.0)).g;
  c.b = texture(u_texture, v_uv + vec2(bOff, 0.0)).b;
  c.a = 1.0;

  float noise = hash(vec2(v_uv * vec2(480.0, 320.0) + floor(t * 30.0))) * u_amount * 0.15;
  c.rgb += noise;
  c.rgb += bar * 0.15;

  outColor = c;
}`,
		animated: true,
		setUniforms: floats('amount', 'speed', 'tracking'),
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

	'chromatic-aberration': {
		fragment:
			H +
			`uniform float u_amount;
uniform float u_falloff;
void main() {
  vec2 center = vec2(0.5);
  vec2 dir = v_uv - center;
  float dist = length(dir);
  float strength = u_amount * pow(dist, 1.0 + u_falloff * 3.0) * 0.1;
  vec2 offset = normalize(dir + 1e-6) * strength;
  outColor = vec4(
    texture(u_texture, v_uv + offset).r,
    texture(u_texture, v_uv).g,
    texture(u_texture, v_uv - offset).b,
    texture(u_texture, v_uv).a
  );
}`,
		setUniforms: floats('amount', 'falloff'),
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
			`uniform float u_amount;
uniform float u_angle;
float bounce(float v) {
  v = mod(abs(v), 2.0);
  return v > 1.0 ? 2.0 - v : v;
}
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
uniform float u_speed;
void main() {
  float t = u_time * u_speed;
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
		setUniforms: floats('intensity', 'speed'),
	},

	'spectral-shift': {
		fragment:
			H +
			`uniform float u_hueShift;
uniform float u_satWarp;
uniform float u_speed;
vec3 rgb2hsl(vec3 c) {
  float mx = max(c.r, max(c.g, c.b));
  float mn = min(c.r, min(c.g, c.b));
  float l = (mx + mn) * 0.5;
  if (mx == mn) return vec3(0.0, 0.0, l);
  float d = mx - mn;
  float s = l > 0.5 ? d / (2.0 - mx - mn) : d / (mx + mn);
  float h;
  if (mx == c.r) h = (c.g - c.b) / d + (c.g < c.b ? 6.0 : 0.0);
  else if (mx == c.g) h = (c.b - c.r) / d + 2.0;
  else h = (c.r - c.g) / d + 4.0;
  return vec3(h / 6.0, s, l);
}
float hue2rgb(float p, float q, float t) {
  t = fract(t);
  if (t < 1.0 / 6.0) return p + (q - p) * 6.0 * t;
  if (t < 0.5) return q;
  if (t < 2.0 / 3.0) return p + (q - p) * (2.0 / 3.0 - t) * 6.0;
  return p;
}
vec3 hsl2rgb(vec3 hsl) {
  if (hsl.y == 0.0) return vec3(hsl.z);
  float q = hsl.z < 0.5 ? hsl.z * (1.0 + hsl.y) : hsl.z + hsl.y - hsl.z * hsl.y;
  float p = 2.0 * hsl.z - q;
  return vec3(
    hue2rgb(p, q, hsl.x + 1.0 / 3.0),
    hue2rgb(p, q, hsl.x),
    hue2rgb(p, q, hsl.x - 1.0 / 3.0)
  );
}
void main() {
  vec4 c = texture(u_texture, v_uv);
  vec3 hsl = rgb2hsl(c.rgb);
  float t = u_time * u_speed;
  hsl.x = fract(hsl.x + u_hueShift * sin(v_uv.y * 8.0 + t) * sin(v_uv.x * 6.0 + t * 0.7));
  hsl.y = clamp(hsl.y * (1.0 + u_satWarp * cos(v_uv.x * 10.0 + t * 1.3)), 0.0, 1.0);
  outColor = vec4(hsl2rgb(hsl), c.a);
}`,
		animated: true,
		setUniforms: floats('hueShift', 'satWarp', 'speed'),
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
  float row = floor(v_uv.y * u_chunkSize);
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
uniform float u_speed;
float hash(vec2 p) {
  return fract(sin(dot(p, vec2(12.9898, 78.233))) * 43758.5453);
}
void main() {
  vec2 ts = vec2(textureSize(u_texture, 0));
  float t = u_time * u_speed;
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
		setUniforms: floats('amount', 'speed'),
	},

	fractalize: {
		fragment:
			H +
			`uniform float u_amount;
  uniform float u_threshold;
  uniform float u_zoom;
  uniform float u_detail;
  uniform float u_speed;
  
  vec3 palette(float t) {
    return 0.5 + 0.5 * cos(6.28318 * (t + vec3(0.0, 0.33, 0.67)));
  }
  
  void main() {
    vec4 orig = texture(u_texture, v_uv);
  
    float luma = dot(orig.rgb, vec3(0.2126, 0.7152, 0.0722));
  
    float mask = 1.0 - smoothstep(u_threshold - 0.08, u_threshold + 0.08, luma);
  
    if (mask < 0.001) {
      outColor = orig;
      return;
    }
  
    float t = u_time * u_speed;

    float region = fract(sin(dot(v_uv, vec2(127.1, 311.7))) * 43758.5453);
    vec2 c;
    if (region < 0.33) {
      c = vec2(-0.7269 + 0.01 * sin(t * 0.31),  0.1889 + 0.04 * sin(t * 0.6));
    } else if (region < 0.66) {
      c = vec2(-0.4    + 0.03 * cos(t * 0.5),   0.6    + 0.03 * sin(t * 0.4));
    } else {
      c = vec2( 0.285  + 0.02 * sin(t * 0.7),   0.01   + 0.02 * cos(t * 0.8));
    }
  
    float scale = exp2(u_zoom);
    vec2 pan    = vec2(sin(t * 0.23) * 0.5, cos(t * 0.31) * 0.5);
    vec2 z      = (v_uv - 0.5) * 2.0 / scale + pan;
  
    float smoothIter = 0.0;
    float escaped    = 0.0;
    for (int i = 0; i < 64; i++) {
      if (float(i) >= u_detail) break;
      z = vec2(z.x * z.x - z.y * z.y, 2.0 * z.x * z.y) + c;
      if (dot(z, z) > 256.0) {
        smoothIter = float(i) - log2(log2(dot(z, z))) + 4.0;
        escaped    = 1.0;
        break;
      }
    }
  
    vec3 fColor = palette(smoothIter / u_detail + t * 0.05);
  
    float blendStrength = mask * u_amount * escaped;
    vec3  overlay       = fColor * blendStrength;
  
    outColor = vec4(1.0 - (1.0 - orig.rgb) * (1.0 - overlay), orig.a);
  }`,
		animated: true,
		setUniforms: floats('amount', 'threshold', 'zoom', 'detail', 'speed'),
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
			setInt(gl, l, 'u_palette', p === 'infrared' ? 1 : p === 'night-vision' ? 2 : 0);
		},
	},

	'color-halves': {
		fragment:
			H +
			`uniform float u_position;
uniform float u_angle;
uniform int u_mode;
uniform float u_amount;
vec3 hueRotate(vec3 c, float angle) {
  float rad = angle * 3.14159265 / 180.0;
  float cosA = cos(rad);
  float sinA = sin(rad);
  vec3 k = vec3(0.57735026919);
  return c * cosA + cross(k, c) * sinA + k * dot(k, c) * (1.0 - cosA);
}
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
    treated = 1.0 - treated;
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
				m === 'hue-shift' ? 1 : m === 'desaturate' ? 2 : m === 'high-contrast' ? 3 : 0,
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
uniform float u_speed;
uniform float u_edgeGlow;
uniform float u_outline;

vec2 hash2(vec2 p) {
  p = vec2(dot(p, vec2(127.1, 311.7)), dot(p, vec2(269.5, 183.3)));
  return fract(sin(p) * 43758.5453);
}

float hash1(vec2 p) {
  return fract(sin(dot(p, vec2(12.9898, 78.233))) * 43758.5453);
}

// returns vec3(minDist, secondMinDist, cellId)
vec3 voronoi(vec2 uv, float cells, float t) {
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
      vec2 point = hash2(cellId + t * 0.07);
      // jitter the point within its cell
      point = 0.5 + 0.4 * sin(point * 6.2831 + t * 0.5);
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

  float cellHash = hash1(nearestCell + t * 0.1);
  return vec3(sqrt(minD), sqrt(minD2), cellHash);
}

void main() {
  float t = floor(u_time * 4.0 * u_speed);

  vec3 vor = voronoi(v_uv, u_cells, t);
  float minD = vor.x;
  float minD2 = vor.y;
  float cellHash = vor.z;

  // per-cell random values
  float h1 = cellHash;
  float h2 = fract(cellHash * 127.1);
  float h3 = fract(cellHash * 269.5);
  float h4 = fract(cellHash * 419.2);
  float angle = (h4 - 0.5) * 6.2831 * 0.3;

  // trigger: which cells shatter
  float trigger = step(1.0 - u_chaos, h1);

  // displacement offset per cell
  vec2 disp = (vec2(h2, h3) - 0.5) * 2.0 * u_intensity * 0.25 * trigger;

  // per-cell rotation around cell center
  float s = sin(angle * u_intensity * trigger);
  float c = cos(angle * u_intensity * trigger);
  vec2 centered = v_uv - 0.5;
  vec2 rotated = vec2(centered.x * c - centered.y * s, centered.x * s + centered.y * c);
  vec2 uv = mix(v_uv, rotated + 0.5, trigger * u_intensity * 0.4) + disp;

  // edge detection from Voronoi cell boundaries
  float edge = 1.0 - smoothstep(0.0, 0.08, minD2 - minD);
  float glow = edge * u_edgeGlow * 1.5;

  // RGB channel split per cell
  float split = u_rgbSplit * u_intensity * trigger * 0.04;
  vec2 splitDir = normalize(vec2(h2 - 0.5, h3 - 0.5) + 1e-4);
  vec2 splitOff = splitDir * split;

  vec3 color = vec3(
    texture(u_texture, uv + splitOff).r,
    texture(u_texture, uv).g,
    texture(u_texture, uv - splitOff).b
  );

  // add crack glow (white edge lines)
  color += vec3(glow);

  // shard outline — darken toward edges based on outline opacity
  float outlineEdge = smoothstep(0.0, 0.12, minD2 - minD);
  color = mix(vec3(0.0), color, mix(1.0, outlineEdge, u_outline));

  outColor = vec4(color, 1.0);
}`,
		animated: true,
		setUniforms: floats('intensity', 'cells', 'rgbSplit', 'chaos', 'speed', 'edgeGlow', 'outline'),
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
			setInt(gl, l, 'u_depthSource', ds === 'edges' ? 1 : ds === 'flat' ? 2 : 0);
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
};

export const ANIMATED_EFFECTS = new Set(
	Object.entries(EFFECT_SHADERS)
		.filter(([, def]) => def.animated)
		.map(([id]) => id),
);
