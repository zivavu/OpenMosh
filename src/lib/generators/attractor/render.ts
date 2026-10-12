import { mulberry32 } from "../../rng";
import {
	accumFormat,
	framebuffer,
	fullscreen,
	FULLSCREEN_VS,
	GLSL_COMMON,
	hexRgb,
	loc,
	program,
	setInks,
	texture,
} from "../gpu";
import type { AttractorSpec } from "./spec";
import { searchSystem, SYSTEMS_GLSL } from "./systems";

// 65k orbits step in parallel through transform feedback; every step also
// draws its points into a float density buffer. A 4×4 max-reduction finds the
// peak, then density is tone-mapped by it and given a glow from the mip chain.

const ORBITS = 65536;
const BURN_IN = 24;
const MAX_POINTS = 40e6;

const STEP_VS = `#version 300 es
precision highp float;
precision highp int;
${GLSL_COMMON}
${SYSTEMS_GLSL}
layout(location=0) in vec4 aState;
out vec4 vState;
out float vC;
uniform int uKind;
uniform vec4 uCoef;
uniform int uMaps;
uniform vec4 uAffA[5];
uniform vec4 uAffB[5]; // e, f, variation mix, colour
uniform ivec2 uVar[5];
uniform float uCum[5];
uniform uint uIter, uSeedU;
uniform vec2 uCenter, uScale;
uniform int uSym;
void main(){
  uint h=pcg(uint(gl_VertexID)^pcg(uIter*2654435761u^uSeedU));
  vec2 p=aState.xy;
  float c=aState.z;
  vec2 n;
  if(uKind==0){
    n=vec2(sin(uCoef.x*p.y)+uCoef.z*cos(uCoef.x*p.x), sin(uCoef.y*p.x)+uCoef.w*cos(uCoef.y*p.y));
    c=c*0.92+min(1.0,length(n-p)/2.5)*0.08;
  } else if(uKind==1){
    n=vec2(sin(uCoef.x*p.y)-cos(uCoef.y*p.x), sin(uCoef.z*p.x)-cos(uCoef.w*p.y));
    c=c*0.92+min(1.0,length(n-p)/2.5)*0.08;
  } else {
    float r=u01(h);
    int k=0;
    for(int i=0;i<4;i++) if(i<uMaps-1 && r>uCum[i]) k=i+1;
    vec4 A=uAffA[k], B=uAffB[k];
    vec2 q=vec2(A.x*p.x+A.y*p.y+A.z, A.w*p.x+B.x*p.y+B.y);
    n=mix(variation(uVar[k].x,q), variation(uVar[k].y,q), B.z);
    c=(c+B.w)*0.5;
  }
  if(any(isnan(n))||any(isinf(n))||abs(n.x)>1e6||abs(n.y)>1e6){
    h=pcg(h);
    n=vec2(u01(h),u01(pcg(h)))-0.5;
    c=0.5;
  }
  vState=vec4(n,c,0.);
  vC=c;
  float a=6.28318530718*floor(u01(pcg(h^0x9e3779b9u))*float(uSym))/float(uSym);
  vec2 d=n-uCenter;
  gl_Position=vec4(vec2(d.x*cos(a)-d.y*sin(a), d.x*sin(a)+d.y*cos(a))*uScale,0.,1.);
  gl_PointSize=1.0;
}`;

const STEP_FS = `#version 300 es
precision highp float;
in float vC;
out vec4 o;
void main(){ o=vec4(1.0,vC,0.,0.); }`;

const MAX_FS = `#version 300 es
precision highp float;
uniform sampler2D uSrc;
out vec4 o;
void main(){
  ivec2 size=textureSize(uSrc,0);
  ivec2 base=ivec2(gl_FragCoord.xy)*4;
  float m=0.;
  for(int y=0;y<4;y++) for(int x=0;x<4;x++){
    ivec2 q=base+ivec2(x,y);
    if(q.x<size.x && q.y<size.y) m=max(m,texelFetch(uSrc,q,0).r);
  }
  o=vec4(m,0.,0.,1.);
}`;

const TONE_FS = `#version 300 es
precision highp float;
${GLSL_COMMON}
uniform sampler2D uDens, uMax;
uniform vec3 uBg;
uniform float uExposure, uInvGamma, uLight;
out vec4 o;
void main(){
  vec2 d=texelFetch(uDens,ivec2(gl_FragCoord.xy),0).rg;
  float mx=texelFetch(uMax,ivec2(0),0).r;
  vec3 col=uBg;
  if(d.r>0.){
    float a=min(1.0,pow(log(1.0+d.r)/log(1.0+mx),uInvGamma)*uExposure);
    float t=d.g/d.r;
    col=mix(col, ramp(uLight>0.5 ? 0.05+t*0.6 : 0.35+t*0.65), a);
  }
  o=vec4(col,1.);
}`;

/** Glow: screened over a dark ground, multiplied over a light one. */
const GLOW_FS = `#version 300 es
precision highp float;
uniform sampler2D uImg;
uniform vec2 uRes;
uniform float uGlow, uLod, uLight;
out vec4 o;
void main(){
  vec2 uv=gl_FragCoord.xy/uRes;
  vec3 base=texture(uImg,uv).rgb;
  vec2 px=exp2(uLod)/uRes;
  vec3 g=vec3(0.);
  for(int y=-1;y<=1;y++) for(int x=-1;x<=1;x++)
    g+=textureLod(uImg,uv+vec2(x,y)*px,uLod).rgb;
  g/=9.0;
  vec3 lit=uLight>0.5 ? base*g : 1.0-(1.0-base)*(1.0-g);
  o=vec4(mix(base,lit,uGlow),1.);
}`;

/** Draws into the default framebuffer at w×h. Every rng draw is part of the
 * saved format: reorder one and old images re-render differently. */
export function drawAttractor(
	gl: WebGL2RenderingContext,
	spec: AttractorSpec,
	w: number,
	h: number,
) {
	const rng = mulberry32(spec.seed);
	const u = Math.min(w, h);
	const sym = spec.symmetry;
	const { system, bounds } = searchSystem(rng, spec.system);
	let [x0, x1, y0, y1] = bounds;
	if (sym > 1) {
		const r = Math.max(Math.abs(x0), Math.abs(x1), Math.abs(y0), Math.abs(y1));
		[x0, x1, y0, y1] = [-r, r, -r, r];
	}
	const scale = Math.min((w * 0.86) / (x1 - x0), (h * 0.86) / (y1 - y0));
	const format = accumFormat(gl);

	const init = new Float32Array(ORBITS * 4);
	for (let i = 0; i < ORBITS; i++) {
		init[i * 4] = rng() - 0.5;
		init[i * 4 + 1] = rng() - 0.5;
		init[i * 4 + 2] = 0.5;
	}
	const seedU = (rng() * 0xffffffff) >>> 0;
	const bufs = [0, 1].map(() => {
		const b = gl.createBuffer()!;
		gl.bindBuffer(gl.ARRAY_BUFFER, b);
		gl.bufferData(gl.ARRAY_BUFFER, init, gl.DYNAMIC_COPY);
		return b;
	});
	const vaos = bufs.map((b) => {
		const v = gl.createVertexArray()!;
		gl.bindVertexArray(v);
		gl.bindBuffer(gl.ARRAY_BUFFER, b);
		gl.enableVertexAttribArray(0);
		gl.vertexAttribPointer(0, 4, gl.FLOAT, false, 16, 0);
		return v;
	});
	gl.bindVertexArray(null);
	gl.bindBuffer(gl.ARRAY_BUFFER, null);
	const tf = gl.createTransformFeedback()!;

	const dens = texture(gl, w, h, format);
	const densFbo = framebuffer(gl, dens);
	gl.viewport(0, 0, w, h);
	gl.clearColor(0, 0, 0, 0);
	gl.clear(gl.COLOR_BUFFER_BIT);

	const step = program(gl, STEP_VS, STEP_FS, ["vState"]);
	gl.useProgram(step);
	gl.uniform1i(loc(gl, step, "uKind"), system.kind);
	gl.uniform4fv(loc(gl, step, "uCoef"), system.coef);
	const maps = system.maps;
	const total = maps.reduce((s, m) => s + m.weight, 0);
	const affA = new Float32Array(20);
	const affB = new Float32Array(20);
	const vars = new Int32Array(10);
	const cum = new Float32Array(5);
	let acc = 0;
	maps.forEach((m, i) => {
		affA.set(m.aff.slice(0, 4), i * 4);
		affB.set([m.aff[4], m.aff[5], m.mix, m.color], i * 4);
		vars.set([m.v1, m.v2], i * 2);
		acc += m.weight / total;
		cum[i] = acc;
	});
	gl.uniform1i(loc(gl, step, "uMaps"), maps.length);
	gl.uniform4fv(loc(gl, step, "uAffA"), affA);
	gl.uniform4fv(loc(gl, step, "uAffB"), affB);
	gl.uniform2iv(loc(gl, step, "uVar"), vars);
	gl.uniform1fv(loc(gl, step, "uCum"), cum);
	gl.uniform1ui(loc(gl, step, "uSeedU"), seedU);
	gl.uniform2f(loc(gl, step, "uCenter"), (x0 + x1) / 2, (y0 + y1) / 2);
	gl.uniform2f(loc(gl, step, "uScale"), (scale * 2) / w, (scale * 2) / h);
	gl.uniform1i(loc(gl, step, "uSym"), sym);

	gl.enable(gl.BLEND);
	gl.blendFunc(gl.ONE, gl.ONE);
	const points = Math.min(MAX_POINTS, spec.density * w * h);
	const iters = BURN_IN + Math.max(1, Math.ceil(points / ORBITS));
	let cur = 0;
	gl.bindTransformFeedback(gl.TRANSFORM_FEEDBACK, tf);
	for (let i = 0; i < iters; i++) {
		if (i < BURN_IN) gl.enable(gl.RASTERIZER_DISCARD);
		gl.uniform1ui(loc(gl, step, "uIter"), i);
		gl.bindVertexArray(vaos[cur]);
		gl.bindBufferBase(gl.TRANSFORM_FEEDBACK_BUFFER, 0, bufs[1 - cur]);
		gl.beginTransformFeedback(gl.POINTS);
		gl.drawArrays(gl.POINTS, 0, ORBITS);
		gl.endTransformFeedback();
		gl.bindBufferBase(gl.TRANSFORM_FEEDBACK_BUFFER, 0, null);
		gl.disable(gl.RASTERIZER_DISCARD);
		cur = 1 - cur;
	}
	gl.bindTransformFeedback(gl.TRANSFORM_FEEDBACK, null);
	gl.bindVertexArray(null);
	gl.disable(gl.BLEND);

	const maxProg = program(gl, FULLSCREEN_VS, MAX_FS);
	const scratch: WebGLTexture[] = [];
	const fbos: WebGLFramebuffer[] = [densFbo];
	let src = dens;
	let sw = w;
	let sh = h;
	while (sw > 1 || sh > 1) {
		sw = Math.ceil(sw / 4);
		sh = Math.ceil(sh / 4);
		gl.activeTexture(gl.TEXTURE0);
		const t = texture(gl, sw, sh, format);
		fbos.push(framebuffer(gl, t));
		scratch.push(t);
		gl.viewport(0, 0, sw, sh);
		gl.useProgram(maxProg);
		gl.uniform1i(loc(gl, maxProg, "uSrc"), 0);
		gl.bindTexture(gl.TEXTURE_2D, src);
		fullscreen(gl);
		src = t;
	}

	gl.activeTexture(gl.TEXTURE0);
	const toned = texture(gl, w, h, gl.RGBA8, {
		filter: gl.LINEAR_MIPMAP_LINEAR,
	});
	fbos.push(framebuffer(gl, toned));
	const tone = program(gl, FULLSCREEN_VS, TONE_FS);
	gl.useProgram(tone);
	gl.viewport(0, 0, w, h);
	gl.bindTexture(gl.TEXTURE_2D, dens);
	gl.activeTexture(gl.TEXTURE1);
	gl.bindTexture(gl.TEXTURE_2D, src);
	gl.uniform1i(loc(gl, tone, "uDens"), 0);
	gl.uniform1i(loc(gl, tone, "uMax"), 1);
	const bg = hexRgb(spec.light ? spec.colors[4] : spec.colors[0]);
	gl.uniform3f(loc(gl, tone, "uBg"), bg[0] / 255, bg[1] / 255, bg[2] / 255);
	gl.uniform1f(loc(gl, tone, "uExposure"), spec.exposure);
	gl.uniform1f(loc(gl, tone, "uInvGamma"), 1 / spec.gamma);
	gl.uniform1f(loc(gl, tone, "uLight"), spec.light ? 1 : 0);
	setInks(gl, tone, spec.colors);
	fullscreen(gl);
	gl.bindTexture(gl.TEXTURE_2D, null);

	gl.activeTexture(gl.TEXTURE0);
	gl.bindTexture(gl.TEXTURE_2D, toned);
	gl.generateMipmap(gl.TEXTURE_2D);
	gl.bindFramebuffer(gl.FRAMEBUFFER, null);
	const glow = program(gl, FULLSCREEN_VS, GLOW_FS);
	gl.useProgram(glow);
	gl.uniform1i(loc(gl, glow, "uImg"), 0);
	gl.uniform2f(loc(gl, glow, "uRes"), w, h);
	gl.uniform1f(loc(gl, glow, "uGlow"), spec.glow);
	gl.uniform1f(loc(gl, glow, "uLod"), Math.log2(Math.max(1, u * 0.012)));
	gl.uniform1f(loc(gl, glow, "uLight"), spec.light ? 1 : 0);
	fullscreen(gl);

	bufs.forEach((b) => gl.deleteBuffer(b));
	vaos.forEach((v) => gl.deleteVertexArray(v));
	gl.deleteTransformFeedback(tf);
	[dens, toned, ...scratch].forEach((t) => gl.deleteTexture(t));
	fbos.forEach((f) => gl.deleteFramebuffer(f));
}
