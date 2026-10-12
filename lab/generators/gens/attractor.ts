import { int, pick, type Generator, type Rand } from "../kit";
import {
	begin,
	framebuffer,
	fullscreen,
	FULLSCREEN_VS,
	GLSL_COMMON,
	loc,
	present,
	program,
	rgb01,
	setInks,
	texture,
} from "../gl";

// The parameter search runs a short orbit on the CPU; the picture itself is
// 65k orbits stepped in parallel on the GPU, each step splatted into a density
// buffer, then tone-mapped by its own maximum.

interface FlameMap {
	aff: number[];
	v1: number;
	v2: number;
	mix: number;
	weight: number;
	color: number;
}

interface System {
	kind: 0 | 1 | 2;
	coef: number[];
	maps: FlameMap[];
	step(x: number, y: number, o: Float64Array, rng: Rand): void;
}

function variation(k: number, x: number, y: number, o: Float64Array) {
	const r2 = x * x + y * y;
	const r = Math.sqrt(r2);
	switch (k) {
		case 0:
			o[0] = x;
			o[1] = y;
			return;
		case 1:
			o[0] = Math.sin(x);
			o[1] = Math.sin(y);
			return;
		case 2:
			o[0] = x / (r2 + 1e-9);
			o[1] = y / (r2 + 1e-9);
			return;
		case 3: {
			const s = Math.sin(r2);
			const c = Math.cos(r2);
			o[0] = x * s - y * c;
			o[1] = x * c + y * s;
			return;
		}
		case 4:
			o[0] = ((x - y) * (x + y)) / (r + 1e-9);
			o[1] = (2 * x * y) / (r + 1e-9);
			return;
		case 5:
			o[0] = Math.atan2(x, y) / Math.PI;
			o[1] = r - 1;
			return;
		case 6: {
			const t = Math.atan2(x, y);
			o[0] = r * Math.sin(t * r);
			o[1] = -r * Math.cos(t * r);
			return;
		}
		default: {
			const t = Math.atan2(x, y) / Math.PI;
			o[0] = t * Math.sin(Math.PI * r);
			o[1] = t * Math.cos(Math.PI * r);
		}
	}
}

const VARIATION_GLSL = `
vec2 variation(int k, vec2 p){
  float r2=dot(p,p), r=sqrt(r2);
  if(k==0) return p;
  if(k==1) return sin(p);
  if(k==2) return p/(r2+1e-9);
  if(k==3){ float s=sin(r2), c=cos(r2); return vec2(p.x*s-p.y*c, p.x*c+p.y*s); }
  if(k==4) return vec2((p.x-p.y)*(p.x+p.y), 2.0*p.x*p.y)/(r+1e-9);
  if(k==5) return vec2(atan(p.x,p.y)/PI, r-1.0);
  if(k==6){ float t=atan(p.x,p.y); return vec2(r*sin(t*r), -r*cos(t*r)); }
  float t=atan(p.x,p.y)/PI; return vec2(t*sin(PI*r), t*cos(PI*r));
}`;

function clifford(rng: Rand): System {
	const [a, b, c, d] = [0, 0, 0, 0].map(() => (rng() - 0.5) * 4);
	return {
		kind: 0,
		coef: [a, b, c, d],
		maps: [],
		step(x, y, o) {
			o[0] = Math.sin(a * y) + c * Math.cos(a * x);
			o[1] = Math.sin(b * x) + d * Math.cos(b * y);
		},
	};
}

function dejong(rng: Rand): System {
	const [a, b, c, d] = [0, 0, 0, 0].map(() => (rng() - 0.5) * 6);
	return {
		kind: 1,
		coef: [a, b, c, d],
		maps: [],
		step(x, y, o) {
			o[0] = Math.sin(a * y) - Math.cos(b * x);
			o[1] = Math.sin(c * x) - Math.cos(d * y);
		},
	};
}

function flame(rng: Rand): System {
	const maps: FlameMap[] = Array.from({ length: int(rng, 2, 5) }, () => ({
		aff: [0, 0, 0, 0, 0, 0].map(() => (rng() - 0.5) * 2),
		v1: int(rng, 0, 7),
		v2: int(rng, 0, 7),
		mix: rng(),
		weight: 0.2 + rng(),
		color: rng(),
	}));
	const total = maps.reduce((s, m) => s + m.weight, 0);
	const tmp = new Float64Array(2);
	return {
		kind: 2,
		coef: [0, 0, 0, 0],
		maps,
		step(x, y, o, r) {
			let left = r() * total;
			let k = 0;
			while (k < maps.length - 1 && (left -= maps[k].weight) > 0) k++;
			const m = maps[k];
			const ax = m.aff[0] * x + m.aff[1] * y + m.aff[2];
			const ay = m.aff[3] * x + m.aff[4] * y + m.aff[5];
			variation(m.v1, ax, ay, tmp);
			const x1 = tmp[0] * (1 - m.mix);
			const y1 = tmp[1] * (1 - m.mix);
			variation(m.v2, ax, ay, tmp);
			o[0] = x1 + tmp[0] * m.mix;
			o[1] = y1 + tmp[1] * m.mix;
		},
	};
}

const MAKERS: Record<string, (rng: Rand) => System> = {
	Clifford: clifford,
	"De Jong": dejong,
	Flame: flame,
};

const SAMPLES = 4000;

/** Keep the candidate whose short orbit covers the most of a 48×48 grid. */
function search(rng: Rand, kind: string) {
	const o = new Float64Array(2);
	let sys = MAKERS[kind](rng);
	let bounds = [-2, 2, -2, 2];
	let best = -1;
	const xs = new Float64Array(SAMPLES);
	const ys = new Float64Array(SAMPLES);
	for (let attempt = 0; attempt < 60 && best < 700; attempt++) {
		const cand = MAKERS[kind](rng);
		let x = rng() - 0.5;
		let y = rng() - 0.5;
		let ok = true;
		for (let i = 0; i < SAMPLES + 100; i++) {
			cand.step(x, y, o, rng);
			x = o[0];
			y = o[1];
			if (!Number.isFinite(x) || !Number.isFinite(y) || Math.abs(x) > 1e6) {
				ok = false;
				break;
			}
			if (i >= 100) {
				xs[i - 100] = x;
				ys[i - 100] = y;
			}
		}
		if (!ok) continue;
		const sx = xs.slice().sort();
		const sy = ys.slice().sort();
		const lo = Math.floor(SAMPLES * 0.01);
		const hi = SAMPLES - 1 - lo;
		const [bx0, bx1, by0, by1] = [sx[lo], sx[hi], sy[lo], sy[hi]];
		if (bx1 - bx0 < 1e-3 || by1 - by0 < 1e-3) continue;
		const occ = new Uint8Array(48 * 48);
		let count = 0;
		for (let i = 0; i < SAMPLES; i++) {
			const gx = Math.floor(((xs[i] - bx0) / (bx1 - bx0)) * 48);
			const gy = Math.floor(((ys[i] - by0) / (by1 - by0)) * 48);
			if (gx < 0 || gy < 0 || gx >= 48 || gy >= 48 || occ[gy * 48 + gx])
				continue;
			occ[gy * 48 + gx] = 1;
			count++;
		}
		if (count > best) {
			best = count;
			sys = cand;
			bounds = [bx0, bx1, by0, by1];
		}
	}
	return { sys, bounds };
}

const ORBITS = 65536;
const BURN_IN = 24;

const STEP_VS = `#version 300 es
precision highp float;
precision highp int;
${GLSL_COMMON}
${VARIATION_GLSL}
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
  vec2 rot=vec2(d.x*cos(a)-d.y*sin(a), d.x*sin(a)+d.y*cos(a));
  gl_Position=vec4(rot*uScale,0.,1.);
  gl_PointSize=1.0;
}`;

const STEP_FS = `#version 300 es
precision highp float;
in float vC;
out vec4 o;
void main(){ o=vec4(1.0,vC,0.,0.); }`;

/** Each pass keeps the max of a 4×4 block, down to one texel. */
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

/** Glow from the mip chain: screen it over dark grounds, multiply over light. */
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

export const attractor: Generator = {
	id: "attractor",
	name: "Attractors & flames",
	group: "Simulated",
	blurb:
		"Millions of points from a Clifford or De Jong attractor or a fractal-flame IFS, piled into a density buffer and tone-mapped into glowing filaments.",
	params: [
		{
			key: "kind",
			label: "System",
			type: "select",
			options: ["Random", "Clifford", "De Jong", "Flame"],
			value: "Random",
		},
		{
			key: "points",
			label: "Points (millions)",
			type: "range",
			min: 0.5,
			max: 40,
			value: 10,
		},
		{
			key: "exposure",
			label: "Exposure",
			type: "range",
			min: 0.3,
			max: 4,
			value: 1.4,
		},
		{ key: "gamma", label: "Gamma", type: "range", min: 1, max: 4, value: 2.2 },
		{
			key: "symmetry",
			label: "Rotational symmetry",
			type: "range",
			min: 1,
			max: 8,
			step: 1,
			value: 1,
		},
		{ key: "glow", label: "Glow", type: "range", min: 0, max: 1, value: 0.35 },
		{ key: "light", label: "Light background", type: "bool", value: false },
	],
	render(env, p) {
		const { w, h, u, rng, inks } = env;
		const kind =
			p.kind === "Random"
				? pick(rng, ["Clifford", "De Jong", "Flame", "Flame"])
				: (p.kind as string);
		const sym = p.symmetry as number;
		const { sys, bounds } = search(rng, kind);
		let [x0, x1, y0, y1] = bounds;
		if (sym > 1) {
			const r = Math.max(
				Math.abs(x0),
				Math.abs(x1),
				Math.abs(y0),
				Math.abs(y1),
			);
			[x0, x1, y0, y1] = [-r, r, -r, r];
		}
		const scale = Math.min((w * 0.86) / (x1 - x0), (h * 0.86) / (y1 - y0));

		const { gl, accumFormat } = begin(w, h);

		// Orbit state: x, y, colour coordinate.
		const init = new Float32Array(ORBITS * 4);
		for (let i = 0; i < ORBITS; i++) {
			init[i * 4] = rng() - 0.5;
			init[i * 4 + 1] = rng() - 0.5;
			init[i * 4 + 2] = 0.5;
		}
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

		const dens = texture(gl, w, h, accumFormat);
		const densFbo = framebuffer(gl, dens);
		gl.viewport(0, 0, w, h);
		gl.clearColor(0, 0, 0, 0);
		gl.clear(gl.COLOR_BUFFER_BIT);

		const step = program(gl, STEP_VS, STEP_FS, ["vState"]);
		gl.useProgram(step);
		gl.uniform1i(loc(gl, step, "uKind"), sys.kind);
		gl.uniform4fv(loc(gl, step, "uCoef"), sys.coef);
		const maps = sys.maps;
		const total = maps.reduce((s, m) => s + m.weight, 0);
		const affA = new Float32Array(20);
		const affB = new Float32Array(20);
		const vars = new Int32Array(10);
		const cum = new Float32Array(5);
		let acc = 0;
		maps.forEach((m, i) => {
			affA.set([m.aff[0], m.aff[1], m.aff[2], m.aff[3]], i * 4);
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
		gl.uniform1ui(loc(gl, step, "uSeedU"), (rng() * 0xffffffff) >>> 0);
		gl.uniform2f(loc(gl, step, "uCenter"), (x0 + x1) / 2, (y0 + y1) / 2);
		gl.uniform2f(loc(gl, step, "uScale"), (scale * 2) / w, (scale * 2) / h);
		gl.uniform1i(loc(gl, step, "uSym"), sym);

		gl.enable(gl.BLEND);
		gl.blendFunc(gl.ONE, gl.ONE);
		const iters = BURN_IN + Math.ceil(((p.points as number) * 1e6) / ORBITS);
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

		// Max density, reduced 4×4 at a time down to a single texel.
		const maxProg = program(gl, FULLSCREEN_VS, MAX_FS);
		const scratch: WebGLTexture[] = [];
		const fbos: WebGLFramebuffer[] = [];
		let src = dens;
		let sw = w;
		let sh = h;
		while (sw > 1 || sh > 1) {
			sw = Math.ceil(sw / 4);
			sh = Math.ceil(sh / 4);
			const t = texture(gl, sw, sh, accumFormat);
			fbos.push(framebuffer(gl, t));
			scratch.push(t);
			gl.viewport(0, 0, sw, sh);
			gl.useProgram(maxProg);
			gl.uniform1i(loc(gl, maxProg, "uSrc"), 0);
			gl.activeTexture(gl.TEXTURE0);
			gl.bindTexture(gl.TEXTURE_2D, src);
			fullscreen(gl);
			src = t;
		}

		const toned = texture(gl, w, h, gl.RGBA8, {
			filter: gl.LINEAR_MIPMAP_LINEAR,
		});
		const tonedFbo = framebuffer(gl, toned);
		const tone = program(gl, FULLSCREEN_VS, TONE_FS);
		gl.useProgram(tone);
		gl.viewport(0, 0, w, h);
		gl.activeTexture(gl.TEXTURE0);
		gl.bindTexture(gl.TEXTURE_2D, dens);
		gl.activeTexture(gl.TEXTURE1);
		gl.bindTexture(gl.TEXTURE_2D, src);
		gl.uniform1i(loc(gl, tone, "uDens"), 0);
		gl.uniform1i(loc(gl, tone, "uMax"), 1);
		const light = !!p.light;
		gl.uniform3fv(loc(gl, tone, "uBg"), rgb01(light ? inks[4] : inks[0]));
		gl.uniform1f(loc(gl, tone, "uExposure"), p.exposure as number);
		gl.uniform1f(loc(gl, tone, "uInvGamma"), 1 / (p.gamma as number));
		gl.uniform1f(loc(gl, tone, "uLight"), light ? 1 : 0);
		setInks(gl, tone, inks);
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
		gl.uniform1f(loc(gl, glow, "uGlow"), p.glow as number);
		gl.uniform1f(loc(gl, glow, "uLod"), Math.log2(Math.max(1, u * 0.012)));
		gl.uniform1f(loc(gl, glow, "uLight"), light ? 1 : 0);
		fullscreen(gl);
		present(env);

		bufs.forEach((b) => gl.deleteBuffer(b));
		vaos.forEach((v) => gl.deleteVertexArray(v));
		gl.deleteTransformFeedback(tf);
		[dens, toned, ...scratch].forEach((t) => gl.deleteTexture(t));
		[densFbo, tonedFbo, ...fbos].forEach((f) => gl.deleteFramebuffer(f));
	},
};
