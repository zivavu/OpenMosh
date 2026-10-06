import { KEYS_MATCH_GLSL } from "../color-key";
import { CATALOG } from "../effects/catalog";
import { H, type EffectShaderDef } from "./shader-lib";

export type { EffectShaderDef, PrePassDef } from "./shader-lib";

export const VERTEX_SHADER = `#version 300 es
layout(location = 0) in vec2 a_position;
out vec2 v_uv;
uniform float u_flipY;
void main() {
  gl_Position = vec4(a_position.x, a_position.y * u_flipY, 0.0, 1.0);
  v_uv = a_position * 0.5 + 0.5;
}`;

export const PASSTHROUGH_FRAG =
	H +
	`void main() {
  outColor = texture(u_texture, v_uv);
}`;

/** A layer's coverage as an opaque grey, so a transition shader can blend it too. */
export const ALPHA_TO_RGB_FRAG =
	H +
	`void main() {
  outColor = vec4(texture(u_texture, v_uv).aaa, 1.0);
}`;

/** The selection highlight: everything but the layer's pixels dimmed, a bright line
 * just inside its edge and a glow fading out past it. Straight alpha, since it is
 * read back into an ImageData. */
export const LAYER_EDGE_FRAG =
	H +
	`uniform vec2 u_outSize;
const vec3 LINE = vec3(0.431, 0.906, 0.753);
const float DIM = 0.6;
const float LINE_PX = 3.0;
const float GLOW_PX = 10.0;
float covered(vec2 uv) {
  if (uv.x < 0.0 || uv.y < 0.0 || uv.x > 1.0 || uv.y > 1.0) return 0.0;
  return step(0.5, texture(u_texture, uv).a);
}
/** Pixels to the nearest one across the edge, on 16 rays; past GLOW_PX when none is near. */
float edgeDistance(float self, vec2 px) {
  for (float r = 1.0; r <= GLOW_PX; r += 1.0) {
    for (int i = 0; i < 16; i++) {
      float t = float(i) * 0.3926991;
      if (covered(v_uv + vec2(cos(t), sin(t)) * r * px) != self) return r;
    }
  }
  return GLOW_PX + 1.0;
}
void main() {
  float self = covered(v_uv);
  float d = edgeDistance(self, 1.0 / u_outSize);
  if (self > 0.5) {
    outColor = d <= LINE_PX ? vec4(LINE, 1.0) : vec4(0.0);
    return;
  }
  float glow = 0.9 * pow(max(0.0, 1.0 - d / GLOW_PX), 2.0);
  float a = glow + DIM * (1.0 - glow);
  outColor = vec4(LINE * glow / a, a);
}`;

/** Colour from one blend, coverage from the other. */
export const ALPHA_MERGE_FRAG =
	H +
	`uniform sampler2D u_original;
void main() {
  outColor = vec4(texture(u_texture, v_uv).rgb, texture(u_original, v_uv).r);
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

/** The same, ramped to nothing over the outermost "fade" of the box, in box uv.
 * Bleed gives effects room to spill into, but a glow cut off there draws the rectangle. */
float insideLayerSoft(vec2 uv, float fade) {
  float inside = insideLayer(uv);
  if (fade <= 0.0) return inside;
  vec2 d = min(uv, 1.0 - uv) / fade;
  vec2 t = clamp(d, 0.0, 1.0);
  vec2 sm = t * t * (3.0 - 2.0 * t);
  return inside * sm.x * sm.y;
}
`;

/** Chroma keying, shared by the layer placement and the source-edit pass. */
const CHROMA_KEY_GLSL = `${KEYS_MATCH_GLSL}
// <= 0 switches the key off, so unkeyed media costs one compare.
uniform float u_chromaOn;
// Where the connected points cut, in source uv: g = reached. Off at <= 0.
uniform sampler2D u_keyReach;
uniform float u_hasReach;
uniform vec2 u_keyReachTexel;
// Hand-erased coverage in source space; red channel, 1 = keep. Off at <= 0.
uniform sampler2D u_mask;
uniform float u_hasMask;
// The shape being morphed into, and how far along. Unused when u_maskSdf is 0.
uniform sampler2D u_maskNext;
uniform float u_maskMix;
// 1 only while a morph is in progress: masks hold coverage in red, field in alpha.
uniform float u_maskSdf;
// Half-width of the rebuilt edge and the range the field is encoded over, both in
// mask pixels. Must match mask-sdf.ts.
uniform vec2 u_maskSdfShape;
// Where the second shape's middle sits relative to the first's, in mask uv.
uniform vec2 u_maskShift;
// Where the mask sits: xy = offset in source space, z = scale about its centre.
// (0,0,1) leaves it as painted.
uniform vec3 u_maskXform;
// The part of the source to keep: xy = origin, zw = size, both normalized.
uniform vec4 u_crop;

// Grown by a texel: the reach is coarse, and its rim would leave a halo of backdrop.
float keyReach(vec2 srcUv) {
  if (u_hasReach <= 0.0) return 0.0;
  vec2 t = u_keyReachTexel;
  float r = textureLod(u_keyReach, srcUv, 0.0).g;
  r = max(r, textureLod(u_keyReach, srcUv + vec2(t.x, t.y), 0.0).g);
  r = max(r, textureLod(u_keyReach, srcUv + vec2(-t.x, t.y), 0.0).g);
  r = max(r, textureLod(u_keyReach, srcUv + vec2(t.x, -t.y), 0.0).g);
  r = max(r, textureLod(u_keyReach, srcUv + vec2(-t.x, -t.y), 0.0).g);
  return r;
}

// A pixel goes if it matches any point; a connected one only inside its reach.
float keyCoverage(vec3 c, vec2 srcUv) {
  return 1.0 - keysMatch(oklab(c), srcUv, -1.0);
}

/** Crop, erase and key in one go. Returns the media with its coverage in .a. */
vec4 editedSource(sampler2D tex, vec2 uv) {
  vec2 srcUv = uv * u_crop.zw + u_crop.xy;
  vec4 c = texture(tex, srcUv);
  // Sampled in source space too, so cropping doesn't slide the erased areas around.
  if (u_hasMask > 0.0) {
    vec2 mUv = (srcUv - u_maskXform.xy - 0.5) / max(u_maskXform.z, 0.0001) + 0.5;
    // Everything the moved mask no longer covers is kept. Clamping instead would
    // drag the mask's edge pixels across the frame it slid off.
    float inside =
      step(0.0, mUv.x) * step(mUv.x, 1.0) * step(0.0, mUv.y) * step(mUv.y, 1.0);
    float cover;
    if (u_maskSdf > 0.0) {
      // Mid-morph: interpolate where the edge is, not how opaque the two paintings are.
      // A lerp of the fields (alpha) walks one boundary across; a lerp of the
      // coverage would show both blobs.
      vec2 shift = u_maskShift;
      float encA = texture(u_mask, mUv - shift * u_maskMix).a;
      float encB = texture(u_maskNext, mUv + shift * (1.0 - u_maskMix)).a;
      float enc = mix(encA, encB, u_maskMix);
      float d = (enc - 0.5) * 2.0 * u_maskSdfShape.y;
      cover = clamp(d / u_maskSdfShape.x + 0.5, 0.0, 1.0);
      // Whatever both shapes erase stays erased the whole way across. Without this
      // floor a mask painted on over the clip blinks out in the middle.
      float erasedInBoth =
        min(1.0 - texture(u_mask, mUv).r, 1.0 - texture(u_maskNext, mUv).r);
      cover = min(cover, 1.0 - erasedInBoth);
    } else {
      // Sitting on a key, or not animated at all: the painting itself, soft brush edge and all.
      cover = texture(u_mask, mUv).r;
    }
    c.a *= mix(1.0, cover, inside);
  }
  if (u_chromaOn > 0.0) c.a *= keyCoverage(c.rgb, srcUv);
  return c;
}
`;

/** The media editor's preview: the whole source through the same key and erase
 * as the placement, premultiplied for a canvas that composites over the page. */
export const SOURCE_EDIT_PREVIEW_FRAG = `#version 300 es
precision highp float;
uniform sampler2D u_texture;
in vec2 v_uv;
out vec4 outColor;
${CHROMA_KEY_GLSL}
void main() {
  vec4 c = editedSource(u_texture, v_uv);
  outColor = vec4(c.rgb * c.a, c.a);
}`;

/** Place a media layer into a full-frame buffer: fitted, scaled, rotated and
 * centred, with everything outside its box transparent. */
export const LAYER_TRANSFORM_FRAG = `#version 300 es
precision highp float;
uniform sampler2D u_texture;
// Width of the coverage ramp at the box's edges, in box uv. 0 = hard edge.
uniform float u_edgeFade;
in vec2 v_uv;
out vec4 outColor;
${LAYER_BOX_GLSL}
${CHROMA_KEY_GLSL}
void main() {
  vec2 uv = layerUv(v_uv);
  // Coverage is kept here, unlike the source pass: the frame underneath shows through.
  vec4 c = editedSource(u_texture, clamp(uv, 0.0, 1.0));
  // What the edit removed goes in colour too, not only in coverage: the chain reads
  // rgb straight, so a keyed backdrop that kept its green would bloom back through the hole.
  c.rgb *= step(0.001, c.a);
  outColor = c * insideLayerSoft(uv, u_edgeFade);
}`;

/** One sweep of the connected fill along a row or column: a matching texel is
 * reached if it can walk to a reached one without leaving the match. Alternating
 * sweeps flood a region in about as many passes as its outline has turns. */
export const KEY_REACH_SPREAD_FRAG = `#version 300 es
precision highp float;
uniform sampler2D u_texture;
uniform ivec2 u_step;
out vec4 outColor;
void main() {
  ivec2 p = ivec2(gl_FragCoord.xy);
  ivec2 size = textureSize(u_texture, 0);
  vec2 here = texelFetch(u_texture, p, 0).rg;
  float reach = here.g;
  if (here.r > 0.5 && reach < 0.5) {
    for (int dir = -1; dir <= 1; dir += 2) {
      ivec2 q = p;
      for (int i = 0; i < 1024; i++) {
        q += u_step * dir;
        if (q.x < 0 || q.y < 0 || q.x >= size.x || q.y >= size.y) break;
        vec2 s = texelFetch(u_texture, q, 0).rg;
        if (s.r < 0.5) break;
        if (s.g > 0.5) { reach = 1.0; break; }
      }
      if (reach > 0.5) break;
    }
  }
  outColor = vec4(here.r, reach, 0.0, 1.0);
}`;

/** Blend text overlay over main image. u_blendMode: 0=normal,1=multiply,2=add,3=screen,
 * 4=overlay,5=difference,6=exclusion,7=subtract. u_invert 0/1, u_opacity 0-1. */
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
  // Coverage is whatever the layer's own chain produced. A media layer is placed into
  // a transparent frame, and an effect that displaces or blooms past its edges lands outside.
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
  // Source-over, in straight alpha. The mode above already folds the layer's coverage
  // into an opaque base; where the base is clear the layer shows through as itself.
  float outA = mainC.a + a * (1.0 - mainC.a);
  vec3 over = (1.0 - mainC.a) * a * textRgb + mainC.a * blended;
  outColor = vec4(
    outA > 0.0 ? clamp(over / outA, 0.0, 1.0) : vec3(0.0),
    clamp(outA, 0.0, 1.0)
  );
}`;

/** Each effect's shader, by id; the effects themselves live in effects/catalog. */
export const EFFECT_SHADERS: Record<string, EffectShaderDef> =
	Object.fromEntries(
		CATALOG.flatMap(({ definition, shader }) =>
			shader ? [[definition.id, shader]] : [],
		),
	);

export const ANIMATED_EFFECTS = new Set(
	Object.entries(EFFECT_SHADERS)
		.filter(([, def]) => def.animated)
		.map(([id]) => id),
);

// Tracking is a 2D-canvas overlay (no shader) but animates every frame, so the
// render loop must keep running.
ANIMATED_EFFECTS.add("tracking");

/** Effects that paint their own background, so they can't sit on a text layer
 * without filling the frame. */
export const OPAQUE_OUTPUT_EFFECTS = new Set(
	Object.entries(EFFECT_SHADERS)
		.filter(([, def]) => def.opaqueOutput)
		.map(([id]) => id),
);
