import { VERTEX_SHADER } from "./effect-shaders";
import { createProgram, getUniformLocations } from "./utils";

/**
 * A procedural 3D scene, written as GLSL. `frag` defines
 * `vec4 world(vec2 uv, float aspect, float time)`: uv is 0-1 with y up, rgb is the
 * colour and alpha the id of the element hit, 0 for the backdrop. Elements are
 * drawn only while `u_withElements` is 1.
 */
export interface SceneDef {
	id: string;
	frag: string;
}

const HEADER = `#version 300 es
precision highp float;
in vec2 v_uv;
out vec4 outColor;
uniform vec2 u_resolution;
uniform float u_time;
uniform float u_withElements;
`;

const MAIN = `
void main() {
  vec4 w = world(vec2(v_uv.x, 1.0 - v_uv.y), u_resolution.x / u_resolution.y, u_time);
  outColor = vec4(clamp(w.rgb, 0.0, 1.0), u_withElements > 0.5 ? w.a / 255.0 : 1.0);
}`;

/** Part 0 copies the backdrop; any other keeps the pixels whose id matches. */
const PART_FRAG = `#version 300 es
precision highp float;
uniform sampler2D u_ids;
uniform sampler2D u_backdrop;
uniform float u_part;
out vec4 outColor;
void main() {
  ivec2 p = ivec2(gl_FragCoord.xy);
  if (u_part < 0.5) {
    outColor = texelFetch(u_backdrop, p, 0);
    return;
  }
  vec4 c = texelFetch(u_ids, p, 0);
  outColor = abs(c.a * 255.0 - u_part) < 0.5 ? vec4(c.rgb, 1.0) : vec4(0.0);
}`;

interface Program {
	program: WebGLProgram;
	uniforms: Record<string, WebGLUniformLocation>;
}

type SceneProgram =
	| { state: "linking"; program: WebGLProgram; shaders: WebGLShader[] }
	| ({ state: "ready" } & Program)
	| { state: "failed" };

interface Target {
	tex: WebGLTexture;
	fbo: WebGLFramebuffer;
}

interface SceneFrame {
	ids: Target;
	backdrop: Target;
	w: number;
	h: number;
	stamp: string;
	lastUsed: number;
}

/** Two scenes are live while one blends into the next. */
const MAX_FRAMES = 2;

/**
 * Renders scenes into layer textures. Each scene is marched twice per frame, with
 * and without its elements, however many layers read it; each layer then cuts its
 * part out. Scenes compile in the background where the browser allows, so
 * `prepare` one ahead of showing it. Leaves the framebuffer, viewport and program
 * changed.
 */
export class ScenePass {
	#gl: WebGL2RenderingContext;
	#parallel: KHR_parallel_shader_compile | null;
	#programs = new Map<string, SceneProgram>();
	#frames = new Map<string, SceneFrame>();
	#part: Program | null = null;
	#out: WebGLFramebuffer | null = null;
	#tick = 0;

	constructor(gl: WebGL2RenderingContext) {
		this.#gl = gl;
		this.#parallel = gl.getExtension("KHR_parallel_shader_compile");
	}

	/** Firefox lists KHR_parallel_shader_compile in docs but never shipped it. */
	get compilesInBackground(): boolean {
		return this.#parallel !== null;
	}

	/** Starts compiling the scene, if it hasn't. */
	prepare(scene: SceneDef) {
		if (this.#programs.has(scene.id)) return;
		const gl = this.#gl;
		const program = gl.createProgram();
		const shaders = [
			[gl.VERTEX_SHADER, VERTEX_SHADER],
			[gl.FRAGMENT_SHADER, HEADER + scene.frag + MAIN],
		].map(([type, source]) => {
			const shader = gl.createShader(type as number)!;
			gl.shaderSource(shader, source as string);
			gl.compileShader(shader);
			gl.attachShader(program, shader);
			return shader;
		});
		gl.linkProgram(program);
		this.#programs.set(scene.id, { state: "linking", program, shaders });
	}

	/** Draws `part` of the scene at `time` into `tex` (w x h). False while it compiles. */
	draw(
		scene: SceneDef,
		part: number,
		time: number,
		tex: WebGLTexture,
		w: number,
		h: number,
	): boolean {
		const gl = this.#gl;
		const prog = this.#ready(scene);
		const frame = prog && this.#frame(scene.id, w, h);
		if (!prog || !frame) return false;
		frame.lastUsed = this.#tick++;
		const stamp = `${time}|${w}x${h}`;
		if (frame.stamp !== stamp) {
			gl.useProgram(prog.program);
			const u = prog.uniforms;
			gl.uniform1f(u["u_flipY"], 1);
			gl.uniform2f(u["u_resolution"], w, h);
			gl.uniform1f(u["u_time"], time);
			gl.viewport(0, 0, w, h);
			for (const [target, withElements] of [
				[frame.ids, 1],
				[frame.backdrop, 0],
			] as const) {
				gl.bindFramebuffer(gl.FRAMEBUFFER, target.fbo);
				gl.uniform1f(u["u_withElements"], withElements);
				gl.drawArrays(gl.TRIANGLES, 0, 6);
			}
			frame.stamp = stamp;
		}
		const cut = (this.#part ??= this.#compile(PART_FRAG));
		const out = (this.#out ??= gl.createFramebuffer());
		if (!cut || !out) return false;
		gl.bindFramebuffer(gl.FRAMEBUFFER, out);
		gl.framebufferTexture2D(
			gl.FRAMEBUFFER,
			gl.COLOR_ATTACHMENT0,
			gl.TEXTURE_2D,
			tex,
			0,
		);
		gl.viewport(0, 0, w, h);
		gl.useProgram(cut.program);
		gl.uniform1f(cut.uniforms["u_flipY"], 1);
		gl.uniform1f(cut.uniforms["u_part"], part);
		gl.activeTexture(gl.TEXTURE0);
		gl.bindTexture(gl.TEXTURE_2D, frame.ids.tex);
		gl.uniform1i(cut.uniforms["u_ids"], 0);
		gl.activeTexture(gl.TEXTURE1);
		gl.bindTexture(gl.TEXTURE_2D, frame.backdrop.tex);
		gl.uniform1i(cut.uniforms["u_backdrop"], 1);
		gl.drawArrays(gl.TRIANGLES, 0, 6);
		gl.activeTexture(gl.TEXTURE0);
		gl.bindFramebuffer(gl.FRAMEBUFFER, null);
		return true;
	}

	ready(scene: SceneDef): boolean {
		return this.#ready(scene) !== null;
	}

	#ready(scene: SceneDef): Program | null {
		this.prepare(scene);
		const entry = this.#programs.get(scene.id)!;
		if (entry.state === "ready") return entry;
		if (entry.state === "failed") return null;
		const gl = this.#gl;
		if (
			this.#parallel &&
			!gl.getProgramParameter(
				entry.program,
				this.#parallel.COMPLETION_STATUS_KHR,
			)
		) {
			return null;
		}
		if (!gl.getProgramParameter(entry.program, gl.LINK_STATUS)) {
			console.error(
				`Scene "${scene.id}" failed to build:`,
				entry.shaders.map((s) => gl.getShaderInfoLog(s)).join("\n"),
				gl.getProgramInfoLog(entry.program),
			);
			for (const s of entry.shaders) gl.deleteShader(s);
			gl.deleteProgram(entry.program);
			this.#programs.set(scene.id, { state: "failed" });
			return null;
		}
		for (const s of entry.shaders) gl.deleteShader(s);
		const ready: SceneProgram = {
			state: "ready",
			program: entry.program,
			uniforms: getUniformLocations(gl, entry.program),
		};
		this.#programs.set(scene.id, ready);
		return ready;
	}

	#compile(frag: string): Program | null {
		try {
			const program = createProgram(this.#gl, VERTEX_SHADER, frag);
			return { program, uniforms: getUniformLocations(this.#gl, program) };
		} catch (err) {
			console.error(err);
			return null;
		}
	}

	/** The scene's two march targets, evicting the stalest scene's past the cap. */
	#frame(id: string, w: number, h: number): SceneFrame | null {
		const held = this.#frames.get(id);
		if (held && held.w === w && held.h === h) return held;
		if (held) this.#dropFrame(id);
		while (this.#frames.size >= MAX_FRAMES) {
			let stalest = "";
			let oldest = Infinity;
			for (const [key, f] of this.#frames) {
				if (f.lastUsed < oldest) [stalest, oldest] = [key, f.lastUsed];
			}
			this.#dropFrame(stalest);
		}
		const ids = this.#createTarget(w, h);
		const backdrop = this.#createTarget(w, h);
		if (!ids || !backdrop) return null;
		const frame = { ids, backdrop, w, h, stamp: "", lastUsed: 0 };
		this.#frames.set(id, frame);
		return frame;
	}

	#createTarget(w: number, h: number): Target | null {
		const gl = this.#gl;
		const tex = gl.createTexture();
		const fbo = gl.createFramebuffer();
		if (!tex || !fbo) return null;
		gl.bindTexture(gl.TEXTURE_2D, tex);
		gl.texImage2D(
			gl.TEXTURE_2D,
			0,
			gl.RGBA,
			w,
			h,
			0,
			gl.RGBA,
			gl.UNSIGNED_BYTE,
			null,
		);
		gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
		gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
		gl.bindFramebuffer(gl.FRAMEBUFFER, fbo);
		gl.framebufferTexture2D(
			gl.FRAMEBUFFER,
			gl.COLOR_ATTACHMENT0,
			gl.TEXTURE_2D,
			tex,
			0,
		);
		gl.bindFramebuffer(gl.FRAMEBUFFER, null);
		return { tex, fbo };
	}

	#dropFrame(id: string) {
		const frame = this.#frames.get(id);
		if (!frame) return;
		const gl = this.#gl;
		for (const t of [frame.ids, frame.backdrop]) {
			gl.deleteTexture(t.tex);
			gl.deleteFramebuffer(t.fbo);
		}
		this.#frames.delete(id);
	}

	/** Frees the march targets, keeping compiled scenes for next time. */
	releaseFrames() {
		for (const id of [...this.#frames.keys()]) this.#dropFrame(id);
	}

	dispose() {
		this.releaseFrames();
		const gl = this.#gl;
		for (const entry of this.#programs.values()) {
			if (entry.state === "failed") continue;
			if (entry.state === "linking") {
				for (const s of entry.shaders) gl.deleteShader(s);
			}
			gl.deleteProgram(entry.program);
		}
		this.#programs.clear();
		if (this.#part) gl.deleteProgram(this.#part.program);
		this.#part = null;
		if (this.#out) gl.deleteFramebuffer(this.#out);
		this.#out = null;
	}
}
