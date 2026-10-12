import { mulberry32, shuffle } from "../../rng";
import {
	fullscreen,
	FULLSCREEN_VS,
	GLSL_COMMON,
	hexRgb,
	loc,
	program,
} from "../gpu";
import { fbm, makeNoise } from "../noise";
import type { InkSpec } from "./spec";

// Strokes are traced on the CPU through the field sampled on a coarse grid,
// then drawn as one triangle strip in a single multisampled call. A brush
// stroke is one ribbon; the fragment shader draws its bristles across it.

const STROKE_VS = `#version 300 es
precision highp float;
layout(location=0) in vec2 aPos;
layout(location=1) in vec4 aColor;
layout(location=2) in vec2 aEdge; // across 0/1, stroke seed
layout(location=3) in float aAlong;
uniform vec2 uRes;
out vec3 vEdge;
out vec4 vColor;
void main(){
  vEdge=vec3(aEdge.x*2.0-1.0, aAlong, aEdge.y*255.0);
  vColor=aColor;
  vec2 c=aPos/uRes*2.0-1.0;
  gl_Position=vec4(c.x,-c.y,0.,1.);
}`;

const STROKE_FS = `#version 300 es
precision highp float;
${GLSL_COMMON}
in vec3 vEdge;
in vec4 vColor;
uniform int uBrush;
out vec4 o;
const int BRISTLES=6;
float bristle(int b, float x, float t){
  float fb=float(b);
  float r1=hash12(vec2(vEdge.z,fb*7.13));
  float r2=hash12(vec2(fb*3.71,vEdge.z));
  float r3=hash12(vec2(vEdge.z+fb,19.7));
  float centre=(fb/float(BRISTLES-1)-0.5)*1.6;
  float hw=(0.12+0.2*r2)*sin(PI*min(1.0,t/(0.6+0.4*r3)))+0.04;
  float aa=max(fwidth(x),1e-4);
  return (0.25+0.35*r1)*clamp(0.5-(abs(x-centre)-hw)/aa,0.,1.);
}
void main(){
  if(uBrush==0){ o=vColor; return; }
  float x=vEdge.x*1.1;
  float keep=1.0;
  for(int b=0;b<BRISTLES;b++) keep*=1.0-bristle(b,x,vEdge.y);
  o=vec4(vColor.rgb,1.0-keep);
}`;

const GRAIN_FS = `#version 300 es
precision highp float;
${GLSL_COMMON}
uniform sampler2D uImg;
uniform float uGrain, uSeed;
out vec4 o;
void main(){
  vec3 c=texelFetch(uImg,ivec2(gl_FragCoord.xy),0).rgb;
  o=vec4(max(c+(hash12(gl_FragCoord.xy+uSeed)-0.5)*uGrain*0.02,0.),1.);
}`;

/** Field samples across the short side. */
const FIELD_CELLS = 160;
/** Vertex: x, y (f32) · rgba (u8) · across, seed (u8) · along (u16). */
const STRIDE = 16;

/** Draws into the default framebuffer at w×h. Every rng draw is part of the
 * saved format: reorder one and old images re-render differently. */
export function drawInk(
	gl: WebGL2RenderingContext,
	spec: InkSpec,
	w: number,
	h: number,
) {
	const rng = mulberry32(spec.seed);
	const u = Math.min(w, h);
	const s = u / 1080;
	const noise = makeNoise(rng);
	const zoom = spec.zoom / u;
	const octaves = 1 + Math.round(spec.turbulence * 3);
	const turn = Math.PI * 2 * (0.6 + spec.turbulence);
	const base = rng() * Math.PI * 2;
	const brush = spec.style === "brush";
	const ink = spec.colors;
	const pens = shuffle(
		rng,
		spec.dark
			? [ink[2], ink[3], ink[4], ink[3]]
			: [ink[0], ink[1], ink[2], ink[1]],
	).map(hexRgb);
	const grainSeed = rng() * 1000;

	const cell = u / FIELD_CELLS;
	const gw = Math.ceil(w / cell) + 2;
	const gh = Math.ceil(h / cell) + 2;
	const fx = new Float32Array(gw * gh);
	const fy = new Float32Array(gw * gh);
	for (let j = 0; j < gh; j++)
		for (let i = 0; i < gw; i++) {
			const a =
				base + fbm(noise, i * cell * zoom, j * cell * zoom, octaves) * turn;
			fx[j * gw + i] = Math.cos(a);
			fy[j * gw + i] = Math.sin(a);
		}
	let dx = 0;
	let dy = 0;
	const fieldAt = (x: number, y: number) => {
		const gx = Math.min(Math.max(x / cell, 0), gw - 1.001);
		const gy = Math.min(Math.max(y / cell, 0), gh - 1.001);
		const i = Math.floor(gx);
		const j = Math.floor(gy);
		const tx = gx - i;
		const ty = gy - j;
		const k = j * gw + i;
		const ax = fx[k] + (fx[k + 1] - fx[k]) * tx;
		const bx = fx[k + gw] + (fx[k + gw + 1] - fx[k + gw]) * tx;
		const ay = fy[k] + (fy[k + 1] - fy[k]) * tx;
		const by = fy[k + gw] + (fy[k + gw + 1] - fy[k + gw]) * tx;
		const vx = ax + (bx - ax) * ty;
		const vy = ay + (by - ay) * ty;
		const l = Math.hypot(vx, vy) || 1;
		dx = vx / l;
		dy = vy / l;
	};

	const width = spec.width * s;
	const stepLen = Math.max(spec.width * 1.2, 2.2) * s;
	const maxSteps = brush ? Math.ceil(spec.length / 2) : spec.length;
	const half = brush ? width * 1.1 : Math.max(width * 0.2, 0.35);

	// Starts on a jittered grid; four draws each, kept or not, so the
	// sequence doesn't depend on the output size.
	const cols = Math.max(1, Math.ceil(Math.sqrt((spec.strokes * w) / h)));
	const rows = Math.max(1, Math.round((cols * h) / w));
	const starts: { x: number; y: number; pen: number; seed: number }[] = [];
	for (let j = 0; j < rows; j++)
		for (let i = 0; i < cols; i++)
			starts.push({
				x: ((i + 0.5 + (rng() - 0.5)) / cols) * w,
				y: ((j + 0.5 + (rng() - 0.5)) / rows) * h,
				pen: rng(),
				seed: Math.floor(rng() * 256),
			});
	shuffle(rng, starts);

	const trace = (sx: number, sy: number, sign: number, out: number[]) => {
		out.length = 0;
		let x = sx;
		let y = sy;
		for (let i = 0; i < maxSteps; i++) {
			if (x < -half || y < -half || x > w + half || y > h + half) break;
			out.push(x, y);
			fieldAt(x, y);
			x += dx * stepLen * sign;
			y += dy * stepLen * sign;
		}
	};
	const strokes: { pts: Float32Array; pen: number[]; seed: number }[] = [];
	const back: number[] = [];
	const fwd: number[] = [];
	let verts = 0;
	for (const st of starts) {
		trace(st.x, st.y, -1, back);
		trace(st.x, st.y, 1, fwd);
		const count = back.length / 2 - 1 + fwd.length / 2;
		if (count < 4) continue;
		const pts = new Float32Array(count * 2);
		let k = 0;
		for (let i = back.length - 2; i >= 2; i -= 2) {
			pts[k++] = back[i];
			pts[k++] = back[i + 1];
		}
		pts.set(fwd, k);
		const n =
			(noise(st.x * zoom * 0.5 + 9, st.y * zoom * 0.5) * 0.5 + 0.5) * 1.5;
		const pen =
			pens[
				Math.floor((n + (st.pen * 0.8) / pens.length) * pens.length) %
					pens.length
			];
		strokes.push({ pts, pen, seed: st.seed });
		verts += count * 2 + (strokes.length > 1 ? 2 : 0);
	}

	// One strip; strokes are joined by repeating a vertex on each side of the gap.
	const buf = new ArrayBuffer(verts * STRIDE);
	const f32 = new Float32Array(buf);
	const u8 = new Uint8Array(buf);
	const u16 = new Uint16Array(buf);
	const alpha = brush ? 255 : 191;
	let nv = 0;
	const put = (
		x: number,
		y: number,
		pen: number[],
		across: number,
		seed: number,
		t: number,
	) => {
		const o = nv * STRIDE;
		f32[o / 4] = x;
		f32[o / 4 + 1] = y;
		u8[o + 8] = pen[0];
		u8[o + 9] = pen[1];
		u8[o + 10] = pen[2];
		u8[o + 11] = alpha;
		u8[o + 12] = across;
		u8[o + 13] = seed;
		u16[o / 2 + 7] = Math.round(t * 65535);
		nv++;
	};
	const repeat = () => {
		u8.copyWithin(nv * STRIDE, (nv - 1) * STRIDE, nv * STRIDE);
		nv++;
	};
	for (const { pts, pen, seed } of strokes) {
		const count = pts.length / 2;
		const joining = nv > 0;
		if (joining) repeat();
		for (let i = 0; i < count; i++) {
			const a = Math.max(i - 1, 0);
			const b = Math.min(i + 1, count - 1);
			let tx = pts[b * 2] - pts[a * 2];
			let ty = pts[b * 2 + 1] - pts[a * 2 + 1];
			const l = Math.hypot(tx, ty) || 1;
			tx /= l;
			ty /= l;
			const t = i / (count - 1);
			const x = pts[i * 2];
			const y = pts[i * 2 + 1];
			put(x + ty * half, y - tx * half, pen, 0, seed, t);
			if (i === 0 && joining) repeat();
			put(x - ty * half, y + tx * half, pen, 255, seed, t);
		}
	}

	const samples = Math.min(4, gl.getParameter(gl.MAX_SAMPLES) as number);
	const rb = gl.createRenderbuffer()!;
	gl.bindRenderbuffer(gl.RENDERBUFFER, rb);
	gl.renderbufferStorageMultisample(gl.RENDERBUFFER, samples, gl.RGBA8, w, h);
	const msaa = gl.createFramebuffer()!;
	gl.bindFramebuffer(gl.FRAMEBUFFER, msaa);
	gl.framebufferRenderbuffer(
		gl.FRAMEBUFFER,
		gl.COLOR_ATTACHMENT0,
		gl.RENDERBUFFER,
		rb,
	);
	gl.viewport(0, 0, w, h);
	// Light grounds are the lightest ink pulled toward warm paper.
	const bg = spec.dark
		? hexRgb(ink[0])
		: hexRgb(ink[4]).map((c, i) => c * 0.4 + [244, 239, 228][i] * 0.6);
	gl.clearColor(bg[0] / 255, bg[1] / 255, bg[2] / 255, 1);
	gl.clear(gl.COLOR_BUFFER_BIT);

	const vao = gl.createVertexArray()!;
	gl.bindVertexArray(vao);
	const vbo = gl.createBuffer()!;
	gl.bindBuffer(gl.ARRAY_BUFFER, vbo);
	gl.bufferData(gl.ARRAY_BUFFER, buf, gl.STATIC_DRAW);
	gl.enableVertexAttribArray(0);
	gl.vertexAttribPointer(0, 2, gl.FLOAT, false, STRIDE, 0);
	gl.enableVertexAttribArray(1);
	gl.vertexAttribPointer(1, 4, gl.UNSIGNED_BYTE, true, STRIDE, 8);
	gl.enableVertexAttribArray(2);
	gl.vertexAttribPointer(2, 2, gl.UNSIGNED_BYTE, true, STRIDE, 12);
	gl.enableVertexAttribArray(3);
	gl.vertexAttribPointer(3, 1, gl.UNSIGNED_SHORT, true, STRIDE, 14);

	const prog = program(gl, STROKE_VS, STROKE_FS);
	gl.useProgram(prog);
	gl.uniform2f(loc(gl, prog, "uRes"), w, h);
	gl.uniform1i(loc(gl, prog, "uBrush"), brush ? 1 : 0);
	gl.enable(gl.BLEND);
	gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
	if (nv > 0) gl.drawArrays(gl.TRIANGLE_STRIP, 0, nv);
	gl.disable(gl.BLEND);
	gl.bindVertexArray(null);

	// Resolve the samples, then add grain on the way out.
	gl.activeTexture(gl.TEXTURE0);
	const resolved = gl.createTexture()!;
	gl.bindTexture(gl.TEXTURE_2D, resolved);
	gl.texStorage2D(gl.TEXTURE_2D, 1, gl.RGBA8, w, h);
	const rfbo = gl.createFramebuffer()!;
	gl.bindFramebuffer(gl.DRAW_FRAMEBUFFER, rfbo);
	gl.framebufferTexture2D(
		gl.DRAW_FRAMEBUFFER,
		gl.COLOR_ATTACHMENT0,
		gl.TEXTURE_2D,
		resolved,
		0,
	);
	gl.bindFramebuffer(gl.READ_FRAMEBUFFER, msaa);
	gl.blitFramebuffer(0, 0, w, h, 0, 0, w, h, gl.COLOR_BUFFER_BIT, gl.NEAREST);
	gl.bindFramebuffer(gl.FRAMEBUFFER, null);
	const grain = program(gl, FULLSCREEN_VS, GRAIN_FS);
	gl.useProgram(grain);
	gl.uniform1i(loc(gl, grain, "uImg"), 0);
	gl.uniform1f(loc(gl, grain, "uGrain"), spec.grain);
	gl.uniform1f(loc(gl, grain, "uSeed"), grainSeed);
	fullscreen(gl);

	gl.deleteBuffer(vbo);
	gl.deleteVertexArray(vao);
	gl.deleteTexture(resolved);
	gl.deleteRenderbuffer(rb);
	gl.deleteFramebuffer(msaa);
	gl.deleteFramebuffer(rfbo);
}
