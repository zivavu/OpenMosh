// Minimal ISF (Interactive Shader Format) runtime on WebGL2.
// Spec: https://github.com/mrRay/ISF_Spec — supports float/bool/long/color/
// point2D/event/image inputs, multi-pass with PERSISTENT/FLOAT targets and
// WIDTH/HEIGHT expressions, custom .vs files. No audio or IMPORTED textures.

export interface IsfInput {
	NAME: string;
	TYPE: "float" | "bool" | "long" | "color" | "point2D" | "event" | "image" | string;
	LABEL?: string;
	DEFAULT?: number | boolean | number[];
	MIN?: number | number[];
	MAX?: number | number[];
	VALUES?: number[];
	LABELS?: string[];
}

export interface IsfPass {
	TARGET?: string;
	PERSISTENT?: boolean;
	FLOAT?: boolean;
	WIDTH?: string | number;
	HEIGHT?: string | number;
	// Lab extension: sample the target with NEAREST instead of LINEAR.
	FILTER?: "NEAREST" | "LINEAR";
}

export interface IsfHeader {
	DESCRIPTION?: string;
	CREDIT?: string;
	CATEGORIES?: string[];
	INPUTS?: IsfInput[];
	PASSES?: IsfPass[];
	ISFVSN?: string;
	// Lab-only extensions, used by the ported shaders.
	LICENSE?: string;
	SOURCE?: string;
	NOTES?: string;
}

export interface ParsedIsf {
	header: IsfHeader;
	body: string;
}

export function parseIsf(source: string): ParsedIsf {
	const m = /\/\*([\s\S]*?)\*\//.exec(source);
	if (!m) throw new Error("ISF: no JSON header comment");
	let header: IsfHeader;
	try {
		header = JSON.parse(m[1]);
	} catch (e) {
		throw new Error(`ISF: bad JSON header: ${(e as Error).message}`);
	}
	return { header, body: source.slice(m.index + m[0].length) };
}

export type ParamValue = number | boolean | number[];

export function defaultValue(input: IsfInput): ParamValue {
	switch (input.TYPE) {
		case "float":
			return typeof input.DEFAULT === "number"
				? input.DEFAULT
				: typeof input.MIN === "number"
					? input.MIN
					: 0;
		case "bool":
			return !!input.DEFAULT;
		case "event":
			return false;
		case "long":
			if (typeof input.DEFAULT === "number") return input.DEFAULT;
			return input.VALUES?.[0] ?? 0;
		case "color":
			return Array.isArray(input.DEFAULT) ? [...input.DEFAULT] : [1, 1, 1, 1];
		case "point2D":
			return Array.isArray(input.DEFAULT) ? [...input.DEFAULT] : [0.5, 0.5];
		default:
			return 0;
	}
}

// --- GLSL source assembly -------------------------------------------------

const IMG_MACROS = [
	"IMG_NORM_PIXEL",
	"IMG_PIXEL",
	"IMG_THIS_NORM_PIXEL",
	"IMG_THIS_PIXEL",
	"IMG_SIZE",
];

// Splits a top-level comma-separated argument list (handles nested parens).
function splitArgs(s: string): string[] {
	const out: string[] = [];
	let depth = 0;
	let start = 0;
	for (let i = 0; i < s.length; i++) {
		const ch = s[i];
		if (ch === "(" || ch === "[") depth++;
		else if (ch === ")" || ch === "]") depth--;
		else if (ch === "," && depth === 0) {
			out.push(s.slice(start, i).trim());
			start = i + 1;
		}
	}
	out.push(s.slice(start).trim());
	return out;
}

// The IMG_* "functions" take an image *name*, which GLSL can't express as a
// function parameter — ISF hosts rewrite them textually, and so do we.
export function expandImgMacros(body: string): string {
	let out = "";
	let i = 0;
	const re = new RegExp(`\\b(${IMG_MACROS.join("|")})\\s*\\(`, "g");
	let m: RegExpExecArray | null;
	while ((m = re.exec(body))) {
		const name = m[1];
		const argStart = m.index + m[0].length;
		let depth = 1;
		let j = argStart;
		for (; j < body.length && depth > 0; j++) {
			if (body[j] === "(") depth++;
			else if (body[j] === ")") depth--;
		}
		const inner = body.slice(argStart, j - 1);
		// Arguments may themselves contain IMG_ calls.
		const args = splitArgs(expandImgMacros(inner));
		const img = args[0];
		let rep: string;
		switch (name) {
			case "IMG_NORM_PIXEL":
				rep = `texture(${img}, ${args[1]})`;
				break;
			case "IMG_PIXEL":
				rep = `texture(${img}, (${args[1]}) / _${img}_imgSize)`;
				break;
			case "IMG_THIS_NORM_PIXEL":
				rep = `texture(${img}, isf_FragNormCoord)`;
				break;
			case "IMG_THIS_PIXEL":
				rep = `texture(${img}, gl_FragCoord.xy / _${img}_imgSize)`;
				break;
			default:
				rep = `_${img}_imgSize`;
		}
		out += body.slice(i, m.index) + rep;
		i = j;
		re.lastIndex = j;
	}
	return out + body.slice(i);
}

function uniformDecl(input: IsfInput): string {
	switch (input.TYPE) {
		case "float":
			return `uniform float ${input.NAME};`;
		case "bool":
		case "event":
			return `uniform bool ${input.NAME};`;
		case "long":
			return `uniform int ${input.NAME};`;
		case "color":
			return `uniform vec4 ${input.NAME};`;
		case "point2D":
			return `uniform vec2 ${input.NAME};`;
		case "image":
			return `uniform sampler2D ${input.NAME};\nuniform vec2 _${input.NAME}_imgSize;`;
		default:
			return "";
	}
}

function commonPrelude(header: IsfHeader, targets: string[]): string {
	const lines = [
		"precision highp float;",
		"precision highp int;",
		"uniform vec2 RENDERSIZE;",
		"uniform float TIME;",
		"uniform float TIMEDELTA;",
		"uniform int FRAMEINDEX;",
		"uniform int PASSINDEX;",
		"uniform vec4 DATE;",
		"#define texture2D texture",
		"#define texture2DLod textureLod",
	];
	for (const input of header.INPUTS ?? []) lines.push(uniformDecl(input));
	for (const t of targets)
		lines.push(`uniform sampler2D ${t};`, `uniform vec2 _${t}_imgSize;`);
	return lines.join("\n");
}

export function buildFragmentSource(
	header: IsfHeader,
	body: string,
	targets: string[],
): string {
	return [
		"#version 300 es",
		commonPrelude(header, targets),
		"in vec2 isf_FragNormCoord;",
		"out vec4 isf_FragColor;",
		"#define gl_FragColor isf_FragColor",
		"#define varying in",
		"#line 1",
		expandImgMacros(body),
	].join("\n");
}

export function buildVertexSource(
	header: IsfHeader,
	targets: string[],
	customBody?: string,
): string {
	const head = [
		"#version 300 es",
		commonPrelude(header, targets),
		"in vec2 isf_position;",
		"out vec2 isf_FragNormCoord;",
		"#define varying out",
		"#define attribute in",
		"void isf_vertShaderInit() {",
		"	gl_Position = vec4(isf_position, 0.0, 1.0);",
		"	isf_FragNormCoord = isf_position * 0.5 + 0.5;",
		"}",
	];
	if (customBody) head.push("#line 1", expandImgMacros(customBody));
	else head.push("void main() { isf_vertShaderInit(); }");
	return head.join("\n");
}

// --- Runtime ----------------------------------------------------------------

interface Target {
	name: string;
	persistent: boolean;
	float: boolean;
	nearest: boolean;
	width: number;
	height: number;
	// Read/write pair so a pass reading its own target sees last frame's data.
	read: WebGLTexture;
	write: WebGLTexture;
	fbo: WebGLFramebuffer;
}

export interface ImageBinding {
	texture: WebGLTexture;
	width: number;
	height: number;
}

interface PassInfo {
	target?: string;
	widthExpr?: string;
	heightExpr?: string;
}

type SizeExpr = (w: number, h: number, p: Record<string, number>) => number;
const exprCache = new Map<string, SizeExpr>();

function compileExpr(expr: string | number | undefined): SizeExpr | null {
	if (expr === undefined) return null;
	const key = String(expr);
	let fn = exprCache.get(key);
	if (!fn) {
		// `$WIDTH`, `$HEIGHT` and `$inputName` are the only variables ISF allows.
		const js = key.replace(/\$([A-Za-z_][A-Za-z0-9_]*)/g, (_, n) =>
			n === "WIDTH" ? "__w" : n === "HEIGHT" ? "__h" : `(__p[${JSON.stringify(n)}] ?? 0)`,
		);
		fn = new Function("__w", "__h", "__p", `with (Math) { return (${js}); }`) as SizeExpr;
		exprCache.set(key, fn);
	}
	return fn;
}

export class IsfEffect {
	readonly header: IsfHeader;
	readonly program: WebGLProgram;
	readonly passes: PassInfo[];
	private readonly targets = new Map<string, Target>();
	private readonly uniforms = new Map<string, WebGLUniformLocation>();
	private readonly copyProgram: WebGLProgram;
	private readonly copyLoc: WebGLUniformLocation;
	private readonly vao: WebGLVertexArrayObject;
	private readonly floatOk: boolean;
	private readonly blackTex: WebGLTexture;
	frameIndex = 0;
	private startTime = -1;
	private lastTime = 0;

	constructor(
		private readonly gl: WebGL2RenderingContext,
		parsed: ParsedIsf,
		vertexBody?: string,
	) {
		this.header = parsed.header;
		const passesRaw = parsed.header.PASSES?.length ? parsed.header.PASSES : [{}];
		const targetNames: string[] = [];
		this.passes = passesRaw.map((p) => {
			if (p.TARGET && !targetNames.includes(p.TARGET)) targetNames.push(p.TARGET);
			return {
				target: p.TARGET,
				widthExpr: p.WIDTH === undefined ? undefined : String(p.WIDTH),
				heightExpr: p.HEIGHT === undefined ? undefined : String(p.HEIGHT),
			};
		});
		this.floatOk = !!gl.getExtension("EXT_color_buffer_float");
		for (const p of passesRaw) {
			if (!p.TARGET || this.targets.has(p.TARGET)) continue;
			this.targets.set(p.TARGET, {
				name: p.TARGET,
				persistent: !!p.PERSISTENT,
				float: !!p.FLOAT && this.floatOk,
				nearest: p.FILTER === "NEAREST",
				width: 0,
				height: 0,
				read: gl.createTexture()!,
				write: gl.createTexture()!,
				fbo: gl.createFramebuffer()!,
			});
		}

		const vs = buildVertexSource(parsed.header, targetNames, vertexBody);
		const fs = buildFragmentSource(parsed.header, parsed.body, targetNames);
		this.program = linkProgram(gl, vs, fs);
		const count = gl.getProgramParameter(this.program, gl.ACTIVE_UNIFORMS) as number;
		for (let i = 0; i < count; i++) {
			const info = gl.getActiveUniform(this.program, i);
			if (!info) continue;
			const loc = gl.getUniformLocation(this.program, info.name);
			if (loc) this.uniforms.set(info.name, loc);
		}

		this.copyProgram = linkProgram(
			gl,
			`#version 300 es
			in vec2 isf_position; out vec2 uv;
			void main() { gl_Position = vec4(isf_position, 0., 1.); uv = isf_position * .5 + .5; }`,
			`#version 300 es
			precision highp float; in vec2 uv; out vec4 o; uniform sampler2D src;
			void main() { o = texture(src, uv); }`,
		);
		this.copyLoc = gl.getUniformLocation(this.copyProgram, "src")!;

		this.vao = gl.createVertexArray()!;
		gl.bindVertexArray(this.vao);
		const buf = gl.createBuffer();
		gl.bindBuffer(gl.ARRAY_BUFFER, buf);
		gl.bufferData(
			gl.ARRAY_BUFFER,
			new Float32Array([-1, -1, 3, -1, -1, 3]),
			gl.STATIC_DRAW,
		);
		// Both programs use attribute location 0 for isf_position.
		gl.enableVertexAttribArray(0);
		gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);
		gl.bindVertexArray(null);

		this.blackTex = gl.createTexture()!;
		gl.bindTexture(gl.TEXTURE_2D, this.blackTex);
		gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, 1, 1, 0, gl.RGBA, gl.UNSIGNED_BYTE, new Uint8Array(4));
	}

	// Restarts TIME/FRAMEINDEX and wipes persistent buffers.
	reset() {
		this.frameIndex = 0;
		this.startTime = -1;
		for (const t of this.targets.values()) t.width = t.height = 0;
	}

	private ensureTarget(t: Target, w: number, h: number) {
		if (t.width === w && t.height === h) return;
		const gl = this.gl;
		t.width = w;
		t.height = h;
		for (const tex of [t.read, t.write]) {
			gl.bindTexture(gl.TEXTURE_2D, tex);
			const filter = t.nearest ? gl.NEAREST : gl.LINEAR;
			gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, filter);
			gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, filter);
			gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
			gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
			if (t.float)
				gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA16F, w, h, 0, gl.RGBA, gl.HALF_FLOAT, null);
			else gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, w, h, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);
			// Persistent buffers start out black, like a fresh ISF host.
			gl.bindFramebuffer(gl.FRAMEBUFFER, t.fbo);
			gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, tex, 0);
			gl.clearColor(0, 0, 0, 0);
			gl.clear(gl.COLOR_BUFFER_BIT);
		}
	}

	private setParam(name: string, input: IsfInput, value: ParamValue) {
		const loc = this.uniforms.get(name);
		if (!loc) return;
		const gl = this.gl;
		switch (input.TYPE) {
			case "float":
				gl.uniform1f(loc, Number(value));
				break;
			case "bool":
			case "event":
				gl.uniform1i(loc, value ? 1 : 0);
				break;
			case "long":
				gl.uniform1i(loc, Math.round(Number(value)));
				break;
			case "color": {
				const v = value as number[];
				gl.uniform4f(loc, v[0], v[1], v[2], v[3] ?? 1);
				break;
			}
			case "point2D": {
				const v = value as number[];
				gl.uniform2f(loc, v[0], v[1]);
				break;
			}
		}
	}

	/**
	 * Renders one frame. `images` binds each image input by name; unbound
	 * image inputs get a 1x1 transparent black. Output goes to `outFbo`
	 * (null = default framebuffer) at outW x outH.
	 */
	render(
		params: Record<string, ParamValue>,
		images: Record<string, ImageBinding>,
		nowSeconds: number,
		outFbo: WebGLFramebuffer | null,
		outW: number,
		outH: number,
	) {
		const gl = this.gl;
		if (this.startTime < 0) {
			this.startTime = nowSeconds;
			this.lastTime = nowSeconds;
		}
		const time = nowSeconds - this.startTime;
		const dt = nowSeconds - this.lastTime;
		this.lastTime = nowSeconds;

		gl.useProgram(this.program);
		gl.bindVertexArray(this.vao);
		gl.disable(gl.BLEND);
		gl.disable(gl.DEPTH_TEST);

		const u = (n: string) => this.uniforms.get(n);
		const setf = (n: string, v: number) => {
			const l = u(n);
			if (l) gl.uniform1f(l, v);
		};
		setf("TIME", time);
		setf("TIMEDELTA", dt);
		const d = new Date();
		const dl = u("DATE");
		if (dl)
			gl.uniform4f(
				dl,
				d.getFullYear(),
				d.getMonth() + 1,
				d.getDate(),
				d.getHours() * 3600 + d.getMinutes() * 60 + d.getSeconds() + d.getMilliseconds() / 1000,
			);
		const fl = u("FRAMEINDEX");
		if (fl) gl.uniform1i(fl, this.frameIndex);

		// Numeric params, also needed for WIDTH/HEIGHT expressions.
		const numeric: Record<string, number> = {};
		for (const input of this.header.INPUTS ?? []) {
			if (input.TYPE === "image") continue;
			const v = params[input.NAME] ?? defaultValue(input);
			this.setParam(input.NAME, input, v);
			if (typeof v === "number") numeric[input.NAME] = v;
			else if (typeof v === "boolean") numeric[input.NAME] = v ? 1 : 0;
		}

		// Texture units: images first, then targets (fixed order per frame).
		let unit = 0;
		const bindTex = (name: string, tex: WebGLTexture, w: number, h: number) => {
			const l = u(name);
			const sl = u(`_${name}_imgSize`);
			if (!l && !sl) return;
			gl.activeTexture(gl.TEXTURE0 + unit);
			gl.bindTexture(gl.TEXTURE_2D, tex);
			if (l) gl.uniform1i(l, unit);
			if (sl) gl.uniform2f(sl, w, h);
			unit++;
		};
		for (const input of this.header.INPUTS ?? []) {
			if (input.TYPE !== "image") continue;
			const b = images[input.NAME];
			if (b) bindTex(input.NAME, b.texture, b.width, b.height);
			else bindTex(input.NAME, this.blackTex, 1, 1);
		}
		const targetUnits = new Map<string, number>();
		for (const t of this.targets.values()) {
			const wf = compileExpr(this.passes.find((p) => p.target === t.name)?.widthExpr);
			const hf = compileExpr(this.passes.find((p) => p.target === t.name)?.heightExpr);
			const w = Math.max(1, Math.floor(wf ? wf(outW, outH, numeric) : outW));
			const h = Math.max(1, Math.floor(hf ? hf(outW, outH, numeric) : outH));
			this.ensureTarget(t, w, h);
			targetUnits.set(t.name, unit);
			bindTex(t.name, t.read, t.width, t.height);
		}

		const last = this.passes.length - 1;
		this.passes.forEach((pass, i) => {
			const pl = u("PASSINDEX");
			if (pl) gl.uniform1i(pl, i);
			const t = pass.target ? this.targets.get(pass.target) : undefined;
			const isOutput = i === last;
			if (t) {
				gl.bindFramebuffer(gl.FRAMEBUFFER, t.fbo);
				gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, t.write, 0);
				gl.viewport(0, 0, t.width, t.height);
				const rl = u("RENDERSIZE");
				if (rl) gl.uniform2f(rl, t.width, t.height);
			} else {
				gl.bindFramebuffer(gl.FRAMEBUFFER, outFbo);
				gl.viewport(0, 0, outW, outH);
				const rl = u("RENDERSIZE");
				if (rl) gl.uniform2f(rl, outW, outH);
			}
			gl.drawArrays(gl.TRIANGLES, 0, 3);
			if (t) {
				// Later passes (and next frame) read what was just written.
				const tmp = t.read;
				t.read = t.write;
				t.write = tmp;
				const unitIdx = targetUnits.get(t.name)!;
				gl.activeTexture(gl.TEXTURE0 + unitIdx);
				gl.bindTexture(gl.TEXTURE_2D, t.read);
				if (isOutput) {
					// ISF: the final pass is the output even when it names a TARGET.
					gl.useProgram(this.copyProgram);
					gl.bindFramebuffer(gl.FRAMEBUFFER, outFbo);
					gl.viewport(0, 0, outW, outH);
					gl.activeTexture(gl.TEXTURE0 + unitIdx);
					gl.uniform1i(this.copyLoc, unitIdx);
					gl.drawArrays(gl.TRIANGLES, 0, 3);
					gl.useProgram(this.program);
				}
			}
		});

		gl.bindVertexArray(null);
		this.frameIndex++;
	}

	dispose() {
		const gl = this.gl;
		gl.deleteProgram(this.program);
		gl.deleteProgram(this.copyProgram);
		gl.deleteVertexArray(this.vao);
		gl.deleteTexture(this.blackTex);
		for (const t of this.targets.values()) {
			gl.deleteTexture(t.read);
			gl.deleteTexture(t.write);
			gl.deleteFramebuffer(t.fbo);
		}
	}
}

function compile(gl: WebGL2RenderingContext, type: number, src: string): WebGLShader {
	const sh = gl.createShader(type)!;
	gl.shaderSource(sh, src);
	gl.compileShader(sh);
	if (!gl.getShaderParameter(sh, gl.COMPILE_STATUS)) {
		const log = gl.getShaderInfoLog(sh) ?? "";
		gl.deleteShader(sh);
		throw new Error(`${type === gl.VERTEX_SHADER ? "Vertex" : "Fragment"} shader:\n${log}`);
	}
	return sh;
}

function linkProgram(gl: WebGL2RenderingContext, vs: string, fs: string): WebGLProgram {
	const v = compile(gl, gl.VERTEX_SHADER, vs);
	const f = compile(gl, gl.FRAGMENT_SHADER, fs);
	const p = gl.createProgram()!;
	gl.attachShader(p, v);
	gl.attachShader(p, f);
	gl.bindAttribLocation(p, 0, "isf_position");
	gl.linkProgram(p);
	gl.deleteShader(v);
	gl.deleteShader(f);
	if (!gl.getProgramParameter(p, gl.LINK_STATUS)) {
		const log = gl.getProgramInfoLog(p) ?? "";
		gl.deleteProgram(p);
		throw new Error(`Link: ${log}`);
	}
	return p;
}
