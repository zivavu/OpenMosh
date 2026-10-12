import {
	ctx2d,
	fitFont,
	hexRgb,
	HEAVY,
	makeCanvas,
	pick,
	WORDS,
	type Generator,
} from "../kit";

const VERT = `#version 300 es
const vec2 v[3] = vec2[3](vec2(-1.,-1.),vec2(3.,-1.),vec2(-1.,3.));
void main(){ gl_Position = vec4(v[gl_VertexID],0.,1.); }`;

// Gray-Scott with a 9-point Laplacian; feed and kill can drift across the frame.
const STEP = `#version 300 es
precision highp float;
uniform sampler2D uState;
uniform vec2 uSize;
uniform vec4 uFK; // f0, k0, df (across x), dk (across y)
out vec4 o;
vec2 at(ivec2 p){ ivec2 s=ivec2(uSize); return texelFetch(uState, (p+s)%s, 0).xy; }
void main(){
  ivec2 p=ivec2(gl_FragCoord.xy);
  vec2 c=at(p);
  vec2 lap=-c
    +0.2*(at(p+ivec2(1,0))+at(p+ivec2(-1,0))+at(p+ivec2(0,1))+at(p+ivec2(0,-1)))
    +0.05*(at(p+ivec2(1,1))+at(p+ivec2(-1,1))+at(p+ivec2(1,-1))+at(p+ivec2(-1,-1)));
  vec2 uv=gl_FragCoord.xy/uSize;
  float f=uFK.x+uFK.z*(uv.x-0.5);
  float k=uFK.y+uFK.w*(uv.y-0.5);
  float r=c.x*c.y*c.y;
  float a=c.x+(1.0*lap.x-r+f*(1.0-c.x));
  float b=c.y+(0.5*lap.y+r-(k+f)*c.y);
  o=vec4(clamp(a,0.,1.),clamp(b,0.,1.),0.,1.);
}`;

const SHOW = `#version 300 es
precision highp float;
uniform sampler2D uState;
uniform vec2 uRes;
uniform vec3 uC0,uC1,uC2,uC3,uC4;
uniform int uBands;
uniform float uSoft;
uniform vec2 uRange;
uniform float uEmboss;
uniform float uInvert;
out vec4 o;
vec3 ink(int i){ return i==0?uC0:i==1?uC1:i==2?uC2:i==3?uC3:uC4; }
void main(){
  vec2 uv=gl_FragCoord.xy/uRes;
  float v=texture(uState,uv).y;
  float x=clamp((v-uRange.x)/(uRange.y-uRange.x),0.,1.);
  x=mix(x,1.0-x,uInvert);
  float aa=max(fwidth(x)*0.8,uSoft*0.08+1e-4);
  vec3 col=ink(0);
  for(int i=1;i<5;i++){
    if(i>=uBands) break;
    float e=float(i)/float(uBands);
    int idx=(i*4)/(uBands-1);
    col=mix(col,ink(idx),smoothstep(e-aa,e+aa,x));
  }
  vec2 g=vec2(dFdx(v),dFdy(v))*uRes.y*0.6;
  vec3 n=normalize(vec3(-g,1.));
  float lam=dot(n,normalize(vec3(-0.5,0.6,0.8)));
  col*=mix(1.0,0.55+0.6*lam,uEmboss);
  col+=pow(max(lam,0.),24.)*0.25*uEmboss;
  o=vec4(col,1.);
}`;

const PRESETS: Record<string, [number, number]> = {
	Coral: [0.0545, 0.062],
	Mitosis: [0.0367, 0.0649],
	Labyrinth: [0.029, 0.057],
	Worms: [0.078, 0.061],
	Spots: [0.035, 0.065],
	Holes: [0.039, 0.058],
	Chaos: [0.026, 0.051],
	Fingerprint: [0.037, 0.06],
};

let glc: {
	canvas: HTMLCanvasElement;
	gl: WebGL2RenderingContext;
	step: WebGLProgram;
	show: WebGLProgram;
} | null = null;

function program(gl: WebGL2RenderingContext, fs: string): WebGLProgram {
	const make = (type: number, src: string) => {
		const s = gl.createShader(type)!;
		gl.shaderSource(s, src);
		gl.compileShader(s);
		if (!gl.getShaderParameter(s, gl.COMPILE_STATUS))
			throw new Error(gl.getShaderInfoLog(s) ?? "shader");
		return s;
	};
	const p = gl.createProgram()!;
	gl.attachShader(p, make(gl.VERTEX_SHADER, VERT));
	gl.attachShader(p, make(gl.FRAGMENT_SHADER, fs));
	gl.linkProgram(p);
	if (!gl.getProgramParameter(p, gl.LINK_STATUS))
		throw new Error(gl.getProgramInfoLog(p) ?? "link");
	return p;
}

function getGl() {
	if (glc) return glc;
	const canvas = document.createElement("canvas");
	const gl = canvas.getContext("webgl2", {
		preserveDrawingBuffer: true,
		antialias: false,
	});
	if (!gl) throw new Error("WebGL2 unavailable");
	if (!gl.getExtension("EXT_color_buffer_float"))
		throw new Error("EXT_color_buffer_float unavailable");
	gl.bindVertexArray(gl.createVertexArray());
	glc = { canvas, gl, step: program(gl, STEP), show: program(gl, SHOW) };
	return glc;
}

export const reaction: Generator = {
	id: "reaction",
	name: "Reaction–diffusion",
	group: "Simulated",
	blurb:
		"A Gray-Scott chemistry run on the GPU until it settles into coral, fingerprints, worms or dividing cells, then cut into flat bands of ink.",
	params: [
		{
			key: "preset",
			label: "Chemistry",
			type: "select",
			options: ["Random", ...Object.keys(PRESETS), "Drift"],
			value: "Random",
		},
		{
			key: "detail",
			label: "Cells on short side",
			type: "range",
			min: 96,
			max: 640,
			step: 8,
			value: 260,
		},
		{
			key: "steps",
			label: "Steps",
			type: "range",
			min: 200,
			max: 12000,
			step: 100,
			value: 4000,
		},
		{
			key: "start",
			label: "Seeded with",
			type: "select",
			options: ["Specks", "Noise", "Rings", "Word"],
			value: "Specks",
		},
		{
			key: "bands",
			label: "Ink bands",
			type: "range",
			min: 2,
			max: 5,
			step: 1,
			value: 3,
		},
		{
			key: "soft",
			label: "Edge softness",
			type: "range",
			min: 0,
			max: 1,
			value: 0.15,
		},
		{
			key: "emboss",
			label: "Gel lighting",
			type: "range",
			min: 0,
			max: 1,
			value: 0.35,
		},
		{ key: "invert", label: "Invert", type: "bool", value: false },
	],
	render(env, p) {
		const { ctx, w, h, u, rng, inks } = env;
		const { canvas, gl, step, show } = getGl();
		const detail = p.detail as number;
		const sw = Math.round((detail * w) / u);
		const sh = Math.round((detail * h) / u);

		let preset = p.preset as string;
		if (preset === "Random") preset = pick(rng, Object.keys(PRESETS));
		let fk: [number, number, number, number];
		if (preset === "Drift") {
			const f = 0.025 + rng() * 0.03;
			const k = 0.055 + rng() * 0.008;
			fk = [f, k, (rng() - 0.5) * 0.04, (rng() - 0.5) * 0.012];
		} else {
			const [f, k] = PRESETS[preset];
			fk = [f, k, 0, 0];
		}

		// Initial state: u = 1 everywhere, v = 1 wherever the seed pattern is drawn.
		const seed = makeCanvas(sw, sh);
		const sctx = ctx2d(seed);
		sctx.fillStyle = "#000";
		sctx.fillRect(0, 0, sw, sh);
		sctx.fillStyle = "#fff";
		sctx.strokeStyle = "#fff";
		const start = p.start as string;
		if (start === "Specks") {
			// Worms don't spread on their own, so they need many more seeds.
			const density = preset === "Worms" ? 6 : 1;
			const n = Math.round(((sw * sh) / 4000) * (0.5 + rng()) * density);
			for (let i = 0; i < n; i++) {
				const s = 2 + rng() * 8;
				sctx.fillRect(rng() * sw, rng() * sh, s, s);
			}
		} else if (start === "Noise") {
			const n = Math.round((sw * sh) / 90);
			for (let i = 0; i < n; i++) sctx.fillRect(rng() * sw, rng() * sh, 3, 3);
		} else if (start === "Rings") {
			sctx.lineWidth = 3;
			const n = 1 + Math.floor(rng() * 4);
			for (let i = 0; i < n; i++) {
				sctx.beginPath();
				sctx.arc(
					rng() * sw,
					rng() * sh,
					10 + rng() * Math.min(sw, sh) * 0.3,
					0,
					Math.PI * 2,
				);
				sctx.stroke();
			}
		} else if (start === "Word") {
			sctx.textAlign = "center";
			sctx.textBaseline = "middle";
			const word = pick(rng, WORDS);
			fitFont(sctx, word, sw * 0.85, 900, HEAVY);
			sctx.fillText(word, sw / 2, sh / 2);
		}
		const mask = sctx.getImageData(0, 0, sw, sh).data;
		const init = new Float32Array(sw * sh * 4);
		for (let y = 0; y < sh; y++)
			for (let x = 0; x < sw; x++) {
				const src = ((sh - 1 - y) * sw + x) * 4;
				const v = mask[src] / 255;
				const i = (y * sw + x) * 4;
				init[i] = v > 0.5 ? 0.5 : 1;
				init[i + 1] = v > 0.5 ? 0.25 + rng() * 0.05 : 0;
				init[i + 3] = 1;
			}

		const tex = [0, 1].map(() => {
			const t = gl.createTexture()!;
			gl.bindTexture(gl.TEXTURE_2D, t);
			gl.texImage2D(
				gl.TEXTURE_2D,
				0,
				gl.RGBA16F,
				sw,
				sh,
				0,
				gl.RGBA,
				gl.FLOAT,
				init,
			);
			gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
			gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
			gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
			gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
			return t;
		});
		const fbo = tex.map((t) => {
			const f = gl.createFramebuffer()!;
			gl.bindFramebuffer(gl.FRAMEBUFFER, f);
			gl.framebufferTexture2D(
				gl.FRAMEBUFFER,
				gl.COLOR_ATTACHMENT0,
				gl.TEXTURE_2D,
				t,
				0,
			);
			return f;
		});

		gl.useProgram(step);
		gl.uniform2f(gl.getUniformLocation(step, "uSize"), sw, sh);
		gl.uniform4f(gl.getUniformLocation(step, "uFK"), ...fk);
		gl.uniform1i(gl.getUniformLocation(step, "uState"), 0);
		gl.viewport(0, 0, sw, sh);
		gl.activeTexture(gl.TEXTURE0);
		const steps = p.steps as number;
		let cur = 0;
		for (let i = 0; i < steps; i++) {
			gl.bindFramebuffer(gl.FRAMEBUFFER, fbo[1 - cur]);
			gl.bindTexture(gl.TEXTURE_2D, tex[cur]);
			gl.drawArrays(gl.TRIANGLES, 0, 3);
			cur = 1 - cur;
		}

		// Auto-level: each chemistry settles in its own band of v.
		const state = new Float32Array(sw * sh * 4);
		gl.bindFramebuffer(gl.FRAMEBUFFER, fbo[cur]);
		gl.readPixels(0, 0, sw, sh, gl.RGBA, gl.FLOAT, state);
		let lo = 1;
		let hi = 0;
		for (let i = 1; i < state.length; i += 4) {
			lo = Math.min(lo, state[i]);
			hi = Math.max(hi, state[i]);
		}
		if (hi - lo < 0.02) hi = lo + 0.02;

		canvas.width = w;
		canvas.height = h;
		gl.bindFramebuffer(gl.FRAMEBUFFER, null);
		gl.viewport(0, 0, w, h);
		gl.useProgram(show);
		gl.bindTexture(gl.TEXTURE_2D, tex[cur]);
		gl.uniform1i(gl.getUniformLocation(show, "uState"), 0);
		gl.uniform2f(gl.getUniformLocation(show, "uRes"), w, h);
		inks.forEach((c, i) =>
			gl.uniform3fv(
				gl.getUniformLocation(show, `uC${i}`),
				hexRgb(c).map((v) => v / 255),
			),
		);
		gl.uniform1i(gl.getUniformLocation(show, "uBands"), p.bands as number);
		gl.uniform1f(gl.getUniformLocation(show, "uSoft"), p.soft as number);
		gl.uniform2f(
			gl.getUniformLocation(show, "uRange"),
			lo + (hi - lo) * 0.08,
			hi - (hi - lo) * 0.08,
		);
		gl.uniform1f(gl.getUniformLocation(show, "uEmboss"), p.emboss as number);
		gl.uniform1f(gl.getUniformLocation(show, "uInvert"), p.invert ? 1 : 0);
		gl.drawArrays(gl.TRIANGLES, 0, 3);
		ctx.drawImage(canvas, 0, 0);

		tex.forEach((t) => gl.deleteTexture(t));
		fbo.forEach((f) => gl.deleteFramebuffer(f));
	},
};
