import { mulberry32 } from "../../rng";
import {
	fullscreen,
	FULLSCREEN_VS,
	GLSL_COMMON,
	loc,
	program,
	setInks,
	texture,
} from "../gpu";
import { makeNoise } from "../noise";
import { CUTOUT_SCENES, type CutoutSpec } from "./spec";

// One pass: each pixel works out which layer covers it, its antialiasing and
// the soft shadows of the layers above. An edge's wobble varies along one axis
// only (x, or the angle around a centre), so it is tabulated per layer in uLut.
const FS = `#version 300 es
precision highp float;
out vec4 o;
${GLSL_COMMON}
uniform vec2 uRes;
uniform float uU, uSeed, uWobble, uShadow, uLightFront, uGrain, uSunLayer, uArchX, uRows, uClear;
uniform int uScene, uLayers, uIsleCount;
uniform vec4 uSun, uTunnel;
uniform vec4 uIsles[5];
uniform sampler2D uLut;

float lut(float u, int row){ return texture(uLut, vec2(u, (float(row)+0.5)/uRows)).r; }
float around(vec2 d){ return atan(d.y,d.x)/(2.0*PI)+0.5; }

float layerSd(int i, vec2 p){
  float L=float(uLayers), fi=float(i);
  if(uScene==0){
    float base=uRes.y*(0.22+0.7*fi/L);
    float amp=uU*(0.04+0.18*uWobble)*(1.0-fi/(L*1.6));
    return p.y-(base+amp*lut(clamp(p.x/uRes.x,0.,1.),i));
  }
  if(uScene==1){
    float t=fi/(L-1.0);
    vec2 d=p-(uTunnel.xy+uTunnel.zw*(1.0-t));
    return length(d)-uU*(0.08+t*0.55)*(1.0+uWobble*0.35*lut(around(d),i));
  }
  if(uScene==2){
    float t=1.0-(fi-1.0)/(L-1.0), best=-1e9;
    for(int k=0;k<5;k++){
      if(k>=uIsleCount) break;
      vec2 d=p-uIsles[k].xy;
      best=max(best,uIsles[k].z*t*(1.0+uWobble*0.45*lut(around(d),i*5+k))-length(d));
    }
    return best;
  }
  vec2 c=vec2(uArchX,uRes.y+uU*0.05);
  // Opaque arches fill the frame; on a clear ground the outer one sits inside it.
  float maxR=uClear>0.5 ? min(uRes.y*0.85,max(c.x,uRes.x-c.x))
                        : length(vec2(max(c.x,uRes.x-c.x),uRes.y))*1.05;
  vec2 d=p-c;
  float u=clamp(atan(d.y,d.x)/PI+1.0,0.,1.);
  return maxR*(1.0-(fi-1.0)/L)*(1.0+uWobble*0.05*lut(u,i))-length(d);
}

vec3 tone(float i){
  float t=i/(float(uLayers)-1.0);
  return ramp(uLightFront>0.5?t:1.0-t);
}

float cover(float sd){ return clamp(sd/max(fwidth(sd),1e-3)+0.5,0.,1.); }

// Premultiplied "over": a shadow is black at its strength, a layer its tone at
// its coverage. On a clear ground, shadows that fall on nothing stay as soft black.
vec4 over(vec4 dst, vec3 rgb, float a){ return vec4(rgb*a+dst.rgb*(1.0-a), a+dst.a*(1.0-a)); }

void main(){
  vec2 p=vec2(gl_FragCoord.x,uRes.y-gl_FragCoord.y);
  vec4 col=uClear>0.5 ? vec4(0.) : vec4(tone(0.),1.);
  float blur=max(uU*0.018*uShadow,1.0);
  vec2 off=vec2(0.004,0.008)*uU*uShadow;
  float sa=0.55*uShadow;
  if(uScene==0 && uSun.w>0.5){
    col=over(col,vec3(0.),sa*smoothstep(-blur,blur,uSun.z-length(p-off-uSun.xy)));
    col=over(col,tone(uSunLayer),cover(uSun.z-length(p-uSun.xy)));
  }
  for(int i=1;i<14;i++){
    if(i>=uLayers) break;
    col=over(col,vec3(0.),sa*smoothstep(-blur,blur,layerSd(i,p-off)));
    col=over(col,tone(float(i)),cover(layerSd(i,p)));
  }
  vec3 rgb=col.a>0.0 ? col.rgb/col.a : vec3(0.);
  rgb+=(hash12(gl_FragCoord.xy+uSeed)-0.5)*uGrain*0.02;
  o=vec4(max(rgb,0.),col.a);
}`;

const LUT_SIZE = 1024;

/** Draws into the bound framebuffer at w×h. Every rng draw is part of the
 * saved format: reorder one and old images re-render differently. */
export function drawCutout(
	gl: WebGL2RenderingContext,
	spec: CutoutSpec,
	w: number,
	h: number,
) {
	const rng = mulberry32(spec.seed);
	const u = Math.min(w, h);
	const L = spec.layers;
	const scene = CUTOUT_SCENES.indexOf(spec.scene);

	const sunOn = rng() < 0.7;
	const sunR = u * (0.08 + rng() * 0.12);
	const sunX = w * (0.2 + rng() * 0.6);
	const sunY = h * (0.15 + rng() * 0.25);
	const tunnel = [
		w * (0.35 + rng() * 0.3),
		h * (0.35 + rng() * 0.3),
		(rng() - 0.5) * u * 0.25,
		(rng() - 0.5) * u * 0.25,
	];
	const isles = 2 + Math.floor(rng() * 4);
	const isleData = new Float32Array(20);
	for (let k = 0; k < isles; k++)
		isleData.set(
			[rng() * w, rng() * h, u * (0.25 + rng() * 0.45), rng() * 100],
			k * 4,
		);
	const archX = w * (0.3 + rng() * 0.4);
	const grainSeed = rng() * 100;

	// One row per layer (per layer and island for islands), along x or angle.
	const rows = scene === 2 ? L * 5 : L;
	const table = new Float32Array(LUT_SIZE * rows * 4);
	const noise = makeNoise(rng);
	for (let i = 1; i < L; i++)
		for (let k = 0; k < LUT_SIZE; k++) {
			const t = (k + 0.5) / LUT_SIZE;
			const a = t * Math.PI * 2 - Math.PI;
			const put = (row: number, v: number) =>
				(table[(row * LUT_SIZE + k) * 4] = v);
			if (scene === 0) {
				const freq = (1.2 + i * 0.25) / u;
				const x = t * w;
				put(i, noise(x * freq, i * 3.1) + 0.35 * noise(x * freq * 3, i * 5.7));
			} else if (scene === 1)
				put(i, noise(Math.cos(a) * 1.3 + i * 4.1, Math.sin(a) * 1.3 + i * 2.3));
			else if (scene === 2)
				for (let c = 0; c < isles; c++) {
					const kc = isleData[c * 4 + 3];
					put(
						i * 5 + c,
						noise(Math.cos(a) * 1.6 + kc, Math.sin(a) * 1.6 + i * 0.35) +
							0.4 * noise(Math.cos(a) * 4 + kc, Math.sin(a) * 4 + i * 0.5),
					);
				}
			else put(i, noise(t * 9 + i * 9.1, i * 1.7));
		}

	const prog = program(gl, FULLSCREEN_VS, FS);
	gl.useProgram(prog);
	gl.activeTexture(gl.TEXTURE0);
	const lut = texture(gl, LUT_SIZE, rows, gl.RGBA16F, {
		data: table,
		filter: gl.LINEAR,
	});
	const polar = scene === 1 || scene === 2;
	gl.texParameteri(
		gl.TEXTURE_2D,
		gl.TEXTURE_WRAP_S,
		polar ? gl.REPEAT : gl.CLAMP_TO_EDGE,
	);
	gl.uniform1i(loc(gl, prog, "uLut"), 0);
	gl.uniform1f(loc(gl, prog, "uRows"), rows);
	gl.uniform4f(loc(gl, prog, "uSun"), sunX, sunY, sunR, sunOn ? 1 : 0);
	gl.uniform1f(
		loc(gl, prog, "uSunLayer"),
		Math.min(L - 1, Math.round(L * 0.7)),
	);
	gl.uniform4fv(loc(gl, prog, "uTunnel"), tunnel);
	gl.uniform4fv(loc(gl, prog, "uIsles"), isleData);
	gl.uniform1i(loc(gl, prog, "uIsleCount"), isles);
	gl.uniform1f(loc(gl, prog, "uArchX"), archX);
	gl.uniform2f(loc(gl, prog, "uRes"), w, h);
	gl.uniform1f(loc(gl, prog, "uU"), u);
	gl.uniform1f(loc(gl, prog, "uSeed"), grainSeed);
	gl.uniform1i(loc(gl, prog, "uScene"), scene);
	gl.uniform1i(loc(gl, prog, "uLayers"), L);
	gl.uniform1f(loc(gl, prog, "uWobble"), spec.wobble);
	gl.uniform1f(loc(gl, prog, "uShadow"), spec.shadow);
	gl.uniform1f(loc(gl, prog, "uLightFront"), spec.lightFront ? 1 : 0);
	gl.uniform1f(loc(gl, prog, "uGrain"), spec.grain);
	gl.uniform1f(loc(gl, prog, "uClear"), spec.transparent ? 1 : 0);
	setInks(gl, prog, spec.colors);
	fullscreen(gl);
	gl.deleteTexture(lut);
}
