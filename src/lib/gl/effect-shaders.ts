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
in vec2 v_uv;
out vec4 outColor;
`;

export const PASSTHROUGH_FRAG = H + `void main() {
  outColor = texture(u_texture, v_uv);
}`;

export interface EffectShaderDef {
  fragment: string;
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
    setUniforms: (gl, l, v) => setFloat(gl, l, 'u_size', v.size as number),
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
    setUniforms: (gl, l, v) =>
      setFloat(gl, l, 'u_levels', v.levels as number),
  },

  solarize: {
    fragment:
      H +
      `uniform float u_threshold;
void main() {
  vec4 c = texture(u_texture, v_uv);
  outColor = vec4(mix(c.rgb, 1.0 - c.rgb, step(u_threshold, c.rgb)), c.a);
}`,
    setUniforms: (gl, l, v) =>
      setFloat(gl, l, 'u_threshold', v.threshold as number),
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
    setUniforms: (gl, l, v) => {
      setFloat(gl, l, 'u_strength', v.strength as number);
      setFloat(gl, l, 'u_mix', v.mix as number);
    },
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
    setUniforms: (gl, l, v) =>
      setFloat(gl, l, 'u_amount', v.amount as number),
  },

  sharpen: {
    fragment:
      H +
      `uniform float u_amount;
void main() {
  vec2 px = 1.0 / vec2(textureSize(u_texture, 0));
  vec4 c  = texture(u_texture, v_uv);
  vec4 t  = texture(u_texture, v_uv + vec2(0, -px.y));
  vec4 b  = texture(u_texture, v_uv + vec2(0,  px.y));
  vec4 le = texture(u_texture, v_uv + vec2(-px.x, 0));
  vec4 r  = texture(u_texture, v_uv + vec2( px.x, 0));
  vec4 s = c * (1.0 + 4.0*u_amount) - (t+b+le+r) * u_amount;
  outColor = vec4(clamp(s.rgb, 0.0, 1.0), c.a);
}`,
    setUniforms: (gl, l, v) =>
      setFloat(gl, l, 'u_amount', v.amount as number),
  },

  mirror: {
    fragment:
      H +
      `uniform int u_direction;
void main() {
  vec2 uv = v_uv;
  if (u_direction == 0 || u_direction == 2)
    uv.x = uv.x < 0.5 ? uv.x : 1.0 - uv.x;
  if (u_direction == 1 || u_direction == 2)
    uv.y = uv.y < 0.5 ? uv.y : 1.0 - uv.y;
  outColor = texture(u_texture, uv);
}`,
    setUniforms: (gl, l, v) => {
      const dir =
        v.direction === 'horizontal' ? 0 : v.direction === 'vertical' ? 1 : 2;
      setInt(gl, l, 'u_direction', dir);
    },
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
    setUniforms: (gl, l, v) => {
      setFloat(gl, l, 'u_amount', v.amount as number);
      setFloat(gl, l, 'u_angle', v.angle as number);
    },
  },

  'brightness-contrast': {
    fragment:
      H +
      `uniform float u_brightness;
uniform float u_contrast;
void main() {
  vec4 c = texture(u_texture, v_uv);
  vec3 rgb = c.rgb + u_brightness;
  rgb = (rgb - 0.5) * (1.0 + u_contrast) + 0.5;
  outColor = vec4(clamp(rgb, 0.0, 1.0), c.a);
}`,
    setUniforms: (gl, l, v) => {
      setFloat(gl, l, 'u_brightness', v.brightness as number);
      setFloat(gl, l, 'u_contrast', v.contrast as number);
    },
  },

  'hue-saturation': {
    fragment:
      H +
      `uniform float u_hue;
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
  vec3 rgb = hueRotate(c.rgb, u_hue);
  float luma = dot(rgb, vec3(0.299, 0.587, 0.114));
  rgb = mix(vec3(luma), rgb, 1.0 + u_saturation);
  outColor = vec4(clamp(rgb, 0.0, 1.0), c.a);
}`,
    setUniforms: (gl, l, v) => {
      setFloat(gl, l, 'u_hue', v.hue as number);
      setFloat(gl, l, 'u_saturation', v.saturation as number);
    },
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
    setUniforms: (gl, l, v) => {
      setFloat(gl, l, 'u_size', v.size as number);
      setFloat(gl, l, 'u_amount', v.amount as number);
    },
  },

  scanlines: {
    fragment:
      H +
      `uniform float u_count;
uniform float u_amount;
void main() {
  vec4 c = texture(u_texture, v_uv);
  float line = sin(v_uv.y * u_count * 3.14159265) * 0.5 + 0.5;
  outColor = vec4(c.rgb * mix(1.0, line, u_amount), c.a);
}`,
    setUniforms: (gl, l, v) => {
      setFloat(gl, l, 'u_count', v.count as number);
      setFloat(gl, l, 'u_amount', v.amount as number);
    },
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
    setUniforms: (gl, l, v) => {
      setFloat(gl, l, 'u_amount', v.amount as number);
      setFloat(gl, l, 'u_radius', v.radius as number);
    },
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
  vec2 off = vec2(
    hash(vec2(floor(v_uv.y * 500.0), u_seed)) - 0.5,
    hash(vec2(floor(v_uv.x * 500.0), u_seed + 1.0)) - 0.5
  ) * u_amount * px;
  outColor = texture(u_texture, v_uv + off);
}`,
    setUniforms: (gl, l, v) => {
      setFloat(gl, l, 'u_amount', v.amount as number);
      setFloat(gl, l, 'u_seed', v.seed as number);
    },
  },

  wobble: {
    fragment:
      H +
      `uniform float u_amount;
uniform float u_frequency;
void main() {
  vec2 px = 1.0 / vec2(textureSize(u_texture, 0));
  vec2 off = vec2(
    sin(v_uv.y * u_frequency * 6.28318) * u_amount * px.x,
    cos(v_uv.x * u_frequency * 6.28318) * u_amount * px.y
  );
  outColor = texture(u_texture, v_uv + off);
}`,
    setUniforms: (gl, l, v) => {
      setFloat(gl, l, 'u_amount', v.amount as number);
      setFloat(gl, l, 'u_frequency', v.frequency as number);
    },
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
  vec2 off = vec2(
    (hash(u_amount) - 0.5) * 2.0,
    (hash(u_amount + 7.0) - 0.5) * 2.0
  ) * u_amount * px;
  outColor = texture(u_texture, v_uv + off);
}`,
    setUniforms: (gl, l, v) =>
      setFloat(gl, l, 'u_amount', v.amount as number),
  },
};
