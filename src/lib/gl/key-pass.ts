import { hasConnectedPoint, MAX_KEY_POINTS, type ChromaKey } from "../media";
import {
	KEY_REACH_SEED_FRAG,
	KEY_REACH_SPREAD_FRAG,
	VERTEX_SHADER,
} from "./effect-shaders";
import { createProgram, getUniformLocations } from "./utils";

/** The chroma key's GL side, shared by the renderer and the media editor's
 * preview so both cut exactly the same pixels. */

export interface KeyProgram {
	program: WebGLProgram;
	uniforms: Record<string, WebGLUniformLocation>;
}

export function compileKeyProgram(
	gl: WebGL2RenderingContext,
	frag: string,
): KeyProgram {
	const program = createProgram(gl, VERTEX_SHADER, frag);
	return { program, uniforms: getUniformLocations(gl, program) };
}

/** The key's points, for any program built on KEY_POINTS_GLSL. */
export function setKeyPointUniforms(
	gl: WebGL2RenderingContext,
	prog: KeyProgram,
	key: ChromaKey | undefined,
) {
	const u = prog.uniforms;
	if (u["u_keyOn"]) gl.uniform1f(u["u_keyOn"], key?.enabled ? 1 : 0);
	const points = key?.points.slice(0, MAX_KEY_POINTS) ?? [];
	if (u["u_keyCount"]) gl.uniform1i(u["u_keyCount"], points.length);
	const colors = new Float32Array(MAX_KEY_POINTS * 3);
	const tunes = new Float32Array(MAX_KEY_POINTS * 3);
	const connected = new Float32Array(MAX_KEY_POINTS);
	const seeds = new Float32Array(MAX_KEY_POINTS * 2);
	points.forEach((p, i) => {
		colors.set([p.color.r, p.color.g, p.color.b], i * 3);
		tunes.set([Math.max(p.threshold, 0.0001), p.smoothing, p.lumaRange], i * 3);
		connected[i] = p.connected ? 1 : 0;
		seeds.set([p.x, p.y], i * 2);
	});
	if (u["u_keyColors[0]"]) gl.uniform3fv(u["u_keyColors[0]"], colors);
	if (u["u_keyTunes[0]"]) gl.uniform3fv(u["u_keyTunes[0]"], tunes);
	if (u["u_keyConnected[0]"]) gl.uniform1fv(u["u_keyConnected[0]"], connected);
	if (u["u_keySeeds[0]"]) gl.uniform2fv(u["u_keySeeds[0]"], seeds);
}

/** Long edge of the connected key's fill. Coarse on purpose: it only says where
 * the key may cut; the colour test still runs per pixel. */
const REACH_MAX = 192;
/** Fill sweeps per frame, alternating rows and columns. */
const REACH_SWEEPS = 10;
/** A connected point seeds from the matching pixels this close to it, as a share
 * of the long edge: footage drifts, and the exact pixel may not match next frame. */
const SEED_RADIUS = 0.006;
/** Texture unit the fill is sampled from by CHROMA_KEY_GLSL. */
const REACH_UNIT = 5;

/**
 * Where a key's connected points cut, worked out on the GPU over the whole
 * source frame: a match pass, then sweeps that flood it from the seeds.
 * Leaves the framebuffer, viewport and program changed.
 */
export class KeyReachPass {
	#gl: WebGL2RenderingContext;
	#failed = false;
	#state: {
		seed: KeyProgram;
		spread: KeyProgram;
		tex: [WebGLTexture, WebGLTexture];
		fbo: [WebGLFramebuffer, WebGLFramebuffer];
		w: number;
		h: number;
	} | null = null;

	constructor(gl: WebGL2RenderingContext) {
		this.#gl = gl;
	}

	/** The fill for this frame (g = reached), or null when no point is connected. */
	run(
		tex: WebGLTexture,
		texW: number,
		texH: number,
		key: ChromaKey | undefined,
	): WebGLTexture | null {
		if (!hasConnectedPoint(key) || texW <= 0 || texH <= 0) return null;
		const k = Math.min(1, REACH_MAX / Math.max(texW, texH));
		const w = Math.max(1, Math.round(texW * k));
		const h = Math.max(1, Math.round(texH * k));
		const r = this.#ensure(w, h);
		if (!r) return null;
		const gl = this.#gl;
		gl.viewport(0, 0, w, h);

		gl.bindFramebuffer(gl.FRAMEBUFFER, r.fbo[0]);
		gl.useProgram(r.seed.program);
		const seed = r.seed.uniforms;
		if (seed["u_flipY"]) gl.uniform1f(seed["u_flipY"], 1.0);
		setKeyPointUniforms(gl, r.seed, key);
		if (seed["u_seedRadius"]) {
			gl.uniform1f(
				seed["u_seedRadius"],
				Math.max(1, SEED_RADIUS * Math.max(w, h)),
			);
		}
		if (seed["u_reachSize"]) gl.uniform2f(seed["u_reachSize"], w, h);
		gl.activeTexture(gl.TEXTURE0);
		gl.bindTexture(gl.TEXTURE_2D, tex);
		if (seed["u_texture"]) gl.uniform1i(seed["u_texture"], 0);
		gl.drawArrays(gl.TRIANGLES, 0, 6);

		gl.useProgram(r.spread.program);
		const spread = r.spread.uniforms;
		if (spread["u_flipY"]) gl.uniform1f(spread["u_flipY"], 1.0);
		if (spread["u_texture"]) gl.uniform1i(spread["u_texture"], 0);
		let src = 0;
		for (let i = 0; i < REACH_SWEEPS; i++) {
			const dst = 1 - src;
			gl.bindFramebuffer(gl.FRAMEBUFFER, r.fbo[dst]);
			gl.bindTexture(gl.TEXTURE_2D, r.tex[src]);
			if (spread["u_step"]) {
				gl.uniform2i(spread["u_step"], i % 2 === 0 ? 1 : 0, i % 2);
			}
			gl.drawArrays(gl.TRIANGLES, 0, 6);
			src = dst;
		}
		return r.tex[src];
	}

	/** Hands `reach` (from run) to a program built on CHROMA_KEY_GLSL. */
	bind(prog: KeyProgram, reach: WebGLTexture | null) {
		const gl = this.#gl;
		const u = prog.uniforms;
		if (u["u_hasReach"]) gl.uniform1f(u["u_hasReach"], reach ? 1 : 0);
		const r = this.#state;
		if (!reach || !r) return;
		if (u["u_keyReachTexel"]) {
			gl.uniform2f(u["u_keyReachTexel"], 1 / r.w, 1 / r.h);
		}
		if (u["u_keyReach"]) {
			gl.activeTexture(gl.TEXTURE0 + REACH_UNIT);
			gl.bindTexture(gl.TEXTURE_2D, reach);
			gl.uniform1i(u["u_keyReach"], REACH_UNIT);
		}
	}

	#ensure(w: number, h: number) {
		if (this.#failed) return null;
		const gl = this.#gl;
		if (!this.#state) {
			try {
				const seed = compileKeyProgram(gl, KEY_REACH_SEED_FRAG);
				const spread = compileKeyProgram(gl, KEY_REACH_SPREAD_FRAG);
				const tex: [WebGLTexture, WebGLTexture] = [
					this.#texture(w, h),
					this.#texture(w, h),
				];
				const fbo: [WebGLFramebuffer, WebGLFramebuffer] = [
					this.#target(tex[0]),
					this.#target(tex[1]),
				];
				this.#state = { seed, spread, tex, fbo, w, h };
			} catch (err) {
				console.warn("Connected key unavailable:", err);
				this.#failed = true;
				return null;
			}
		}
		const r = this.#state;
		if (r.w !== w || r.h !== h) {
			for (const t of r.tex) this.#allocate(t, w, h);
			r.w = w;
			r.h = h;
		}
		return r;
	}

	#texture(w: number, h: number): WebGLTexture {
		const gl = this.#gl;
		const tex = gl.createTexture()!;
		gl.bindTexture(gl.TEXTURE_2D, tex);
		gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
		gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
		// Read by the placement with LINEAR, so the cut's rim ramps over a texel.
		gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
		gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
		this.#allocate(tex, w, h);
		return tex;
	}

	#allocate(tex: WebGLTexture, w: number, h: number) {
		const gl = this.#gl;
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
	}

	#target(tex: WebGLTexture): WebGLFramebuffer {
		const gl = this.#gl;
		const fbo = gl.createFramebuffer();
		if (!fbo) throw new Error("no framebuffer");
		gl.bindFramebuffer(gl.FRAMEBUFFER, fbo);
		gl.framebufferTexture2D(
			gl.FRAMEBUFFER,
			gl.COLOR_ATTACHMENT0,
			gl.TEXTURE_2D,
			tex,
			0,
		);
		if (gl.checkFramebufferStatus(gl.FRAMEBUFFER) !== gl.FRAMEBUFFER_COMPLETE) {
			throw new Error("key reach target incomplete");
		}
		return fbo;
	}

	dispose() {
		const r = this.#state;
		if (!r) return;
		const gl = this.#gl;
		gl.deleteProgram(r.seed.program);
		gl.deleteProgram(r.spread.program);
		for (const t of r.tex) gl.deleteTexture(t);
		for (const f of r.fbo) gl.deleteFramebuffer(f);
		this.#state = null;
	}
}
