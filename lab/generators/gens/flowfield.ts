import {
	fbm,
	hexRgb,
	makeNoise,
	mixRgb,
	shuffle,
	TAU,
	type Generator,
} from "../kit";
import {
	begin,
	fullscreen,
	FULLSCREEN_VS,
	GLSL_COMMON,
	loc,
	present,
	program,
} from "../gl";

// Strokes are traced on the CPU through a precomputed field grid, then drawn as
// one mesh in a single call, multisampled. A brush stroke is one ribbon whose
// bristles the fragment shader draws across its width.

const STROKE_VS = `#version 300 es
precision highp float;
layout(location=0) in vec2 aPos;
layout(location=1) in vec4 aEdge; // across -1..1, along 0..1, stroke seed, stroke length in widths
layout(location=2) in vec4 aColor;
uniform vec2 uRes;
out vec4 vEdge;
out vec4 vColor;
void main(){
  vEdge=aEdge;
  vColor=aColor;
  gl_Position=vec4(aPos/uRes*2.0-1.0,0.,1.);
  gl_Position.y=-gl_Position.y;
}`;

const STROKE_FS = `#version 300 es
precision highp float;
${GLSL_COMMON}
in vec4 vEdge;
in vec4 vColor;
uniform int uBrush;
out vec4 o;
const int BRISTLES=6;
float bristle(int b, float x, float t){
  float r1=hash12(vec2(vEdge.z,float(b)*7.13));
  float r2=hash12(vec2(float(b)*3.71,vEdge.z));
  float r3=hash12(vec2(vEdge.z+float(b),19.7));
  float centre=(float(b)/float(BRISTLES-1)-0.5)*1.6;
  float fade=0.6+0.4*r3;
  float hw=(0.12+0.2*r2)*sin(PI*min(1.0,t/fade))+0.04;
  float d=abs(x-centre)-hw;
  float aa=max(fwidth(x),1e-4);
  return (0.25+0.35*r1)*clamp(0.5-d/aa,0.,1.);
}
void main(){
  if(uBrush==0){ o=vColor; return; }
  float x=vEdge.x*1.1;
  float t=vEdge.y;
  float keep=1.0;
  for(int b=0;b<BRISTLES;b++) keep*=1.0-bristle(b,x,t);
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
  o=vec4(c+(hash12(gl_FragCoord.xy+uSeed)-0.5)*uGrain,1.);
}`;

export const flowfield: Generator = {
	id: "flowfield",
	name: "Flow-field ink",
	group: "Simulated",
	blurb:
		"Strokes traced through a smooth vector field: fine translucent strands, or brush marks with their own bristles.",
	params: [
		{
			key: "style",
			label: "Style",
			type: "select",
			options: ["Strands", "Brush"],
			value: "Strands",
		},
		{
			key: "count",
			label: "Stroke count",
			type: "range",
			min: 50,
			max: 6000,
			step: 10,
			value: 1500,
		},
		{
			key: "zoom",
			label: "Field scale",
			type: "range",
			min: 0.3,
			max: 6,
			value: 1.6,
		},
		{
			key: "turb",
			label: "Turbulence",
			type: "range",
			min: 0,
			max: 1,
			value: 0.3,
		},
		{
			key: "length",
			label: "Max length",
			type: "range",
			min: 10,
			max: 600,
			step: 1,
			value: 160,
		},
		{
			key: "width",
			label: "Width",
			type: "range",
			min: 0.5,
			max: 30,
			value: 5,
		},
		{ key: "dark", label: "Dark background", type: "bool", value: false },
	],
	render(env, p) {
		const { w, h, u, rng, inks, s } = env;
		const noise = makeNoise(rng);
		const zoom = (p.zoom as number) / u;
		const turb = p.turb as number;
		const octaves = 1 + Math.round(turb * 3);
		const base = rng() * TAU;
		const brush = p.style === "Brush";

		// The field on a coarse grid; tracing reads it back bilinearly.
		const cell = u / 160;
		const gw = Math.ceil(w / cell) + 2;
		const gh = Math.ceil(h / cell) + 2;
		const fx = new Float32Array(gw * gh);
		const fy = new Float32Array(gw * gh);
		for (let j = 0; j < gh; j++)
			for (let i = 0; i < gw; i++) {
				const a =
					base +
					fbm(noise, i * cell * zoom, j * cell * zoom, octaves) *
						TAU *
						(0.6 + turb);
				fx[j * gw + i] = Math.cos(a);
				fy[j * gw + i] = Math.sin(a);
			}
		const dir = new Float32Array(2);
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
			dir[0] = vx / l;
			dir[1] = vy / l;
		};

		const dark = !!p.dark;
		const bg = dark
			? hexRgb(inks[0])
			: mixRgb(hexRgb(inks[4]), hexRgb("#f4efe4"), 0.6);
		const pens = shuffle(
			rng,
			dark
				? [inks[2], inks[3], inks[4], inks[3]]
				: [inks[0], inks[1], inks[2], inks[1]],
		).map(hexRgb);
		const width = (p.width as number) * s;
		// Brush strokes used to step at half this; same length, half the points.
		const stepLen = Math.max(1, width * 1.2, u * 0.002);
		const maxSteps = brush
			? Math.ceil((p.length as number) / 2)
			: (p.length as number);
		const half = brush ? width * 1.1 : Math.max(width * 0.2, 0.35);

		const n = p.count as number;
		const side = Math.ceil(Math.sqrt(n * (w / h)));
		const gap = w / side;
		const starts: [number, number][] = [];
		for (let y = gap / 2; y < h; y += gap)
			for (let x = gap / 2; x < w; x += gap)
				starts.push([x + (rng() - 0.5) * gap, y + (rng() - 0.5) * gap]);
		shuffle(rng, starts);

		const trace = (sx: number, sy: number, sign: number, out: number[]) => {
			out.length = 0;
			let x = sx;
			let y = sy;
			for (let i = 0; i < maxSteps; i++) {
				if (x < -half || y < -half || x > w + half || y > h + half) break;
				out.push(x, y);
				fieldAt(x, y);
				x += dir[0] * stepLen * sign;
				y += dir[1] * stepLen * sign;
			}
		};
		interface Stroke {
			pts: Float32Array;
			pen: number[];
			seed: number;
		}
		const strokes: Stroke[] = [];
		const back: number[] = [];
		const fwd: number[] = [];
		let totalPts = 0;
		for (const [sx, sy] of starts) {
			trace(sx, sy, -1, back);
			trace(sx, sy, 1, fwd);
			const count = back.length / 2 - 1 + fwd.length / 2;
			if (count < 4) continue;
			const pts = new Float32Array(count * 2);
			let k = 0;
			for (let i = back.length - 2; i >= 2; i -= 2) {
				pts[k++] = back[i];
				pts[k++] = back[i + 1];
			}
			pts.set(fwd, k);
			const pen =
				pens[
					Math.floor(
						(noise(sx * zoom * 0.5 + 9, sy * zoom * 0.5) * 0.5 + 0.5) *
							pens.length *
							1.5 +
							rng() * 0.8,
					) % pens.length
				];
			strokes.push({ pts, pen, seed: rng() * 100 });
			totalPts += count;
		}

		// Mesh: per vertex x, y, across, along, seed, unused (floats) + rgba (bytes).
		const verts = new ArrayBuffer(totalPts * 2 * 28);
		const vf = new Float32Array(verts);
		const vb = new Uint8Array(verts);
		const idx = new Uint32Array(Math.max(0, totalPts - strokes.length) * 6);
		const alpha = brush ? 255 : 191;
		let nv = 0;
		let ni = 0;
		for (const { pts, pen, seed } of strokes) {
			const count = pts.length / 2;
			const first = nv;
			for (let i = 0; i < count; i++) {
				const a = Math.max(i - 1, 0);
				const b = Math.min(i + 1, count - 1);
				let dx = pts[b * 2] - pts[a * 2];
				let dy = pts[b * 2 + 1] - pts[a * 2 + 1];
				const l = Math.hypot(dx, dy) || 1;
				dx /= l;
				dy /= l;
				const t = i / (count - 1);
				for (let side = -1; side <= 1; side += 2) {
					const o = nv * 7;
					vf[o] = pts[i * 2] - dy * half * side;
					vf[o + 1] = pts[i * 2 + 1] + dx * half * side;
					vf[o + 2] = side;
					vf[o + 3] = t;
					vf[o + 4] = seed;
					const c = o * 4 + 24;
					vb[c] = pen[0];
					vb[c + 1] = pen[1];
					vb[c + 2] = pen[2];
					vb[c + 3] = alpha;
					nv++;
				}
			}
			for (let i = 0; i < count - 1; i++) {
				const v = first + i * 2;
				idx[ni++] = v;
				idx[ni++] = v + 1;
				idx[ni++] = v + 2;
				idx[ni++] = v + 1;
				idx[ni++] = v + 3;
				idx[ni++] = v + 2;
			}
		}

		const { gl } = begin(w, h);
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
		gl.clearColor(bg[0] / 255, bg[1] / 255, bg[2] / 255, 1);
		gl.clear(gl.COLOR_BUFFER_BIT);

		const vao = gl.createVertexArray()!;
		gl.bindVertexArray(vao);
		const vbo = gl.createBuffer()!;
		gl.bindBuffer(gl.ARRAY_BUFFER, vbo);
		gl.bufferData(gl.ARRAY_BUFFER, verts, gl.STATIC_DRAW);
		gl.enableVertexAttribArray(0);
		gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 28, 0);
		gl.enableVertexAttribArray(1);
		gl.vertexAttribPointer(1, 4, gl.FLOAT, false, 28, 8);
		gl.enableVertexAttribArray(2);
		gl.vertexAttribPointer(2, 4, gl.UNSIGNED_BYTE, true, 28, 24);
		const ibo = gl.createBuffer()!;
		gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, ibo);
		gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, idx, gl.STATIC_DRAW);

		const prog = program(gl, STROKE_VS, STROKE_FS);
		gl.useProgram(prog);
		gl.uniform2f(loc(gl, prog, "uRes"), w, h);
		gl.uniform1i(loc(gl, prog, "uBrush"), brush ? 1 : 0);
		gl.enable(gl.BLEND);
		gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
		gl.drawElements(gl.TRIANGLES, ni, gl.UNSIGNED_INT, 0);
		gl.disable(gl.BLEND);
		gl.bindVertexArray(null);

		// Resolve the samples, then add grain on the way to the canvas.
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
		gl.activeTexture(gl.TEXTURE0);
		gl.bindTexture(gl.TEXTURE_2D, resolved);
		gl.uniform1i(loc(gl, grain, "uImg"), 0);
		gl.uniform1f(loc(gl, grain, "uGrain"), 0.035);
		gl.uniform1f(loc(gl, grain, "uSeed"), rng() * 1000);
		fullscreen(gl);
		present(env);

		gl.deleteBuffer(vbo);
		gl.deleteBuffer(ibo);
		gl.deleteVertexArray(vao);
		gl.deleteTexture(resolved);
		gl.deleteRenderbuffer(rb);
		gl.deleteFramebuffer(msaa);
		gl.deleteFramebuffer(rfbo);
	},
};
