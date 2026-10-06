import { KEY_REACH_SEED_FRAG, packKeys, setKeyUniforms } from "../color-key";
import { hasConnectedPoint, keyPointSpec, type ChromaKey } from "../media";
import { KEY_REACH_SPREAD_FRAG, VERTEX_SHADER } from "./effect-shaders";
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

/** The key's points, for any program built on CHROMA_KEY_GLSL or the reach seed. */
export function setKeyPointUniforms(
	gl: WebGL2RenderingContext,
	prog: KeyProgram,
	key: ChromaKey | undefined,
) {
	const u = prog.uniforms;
	if (u["u_chromaOn"]) gl.uniform1f(u["u_chromaOn"], key?.enabled ? 1 : 0);
	setKeyUniforms(gl, u, packKeys(key?.points.map(keyPointSpec) ?? []));
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
 * A flood over a frame at low res, on the GPU: a seed pass marks r = passable and
 * g = reached, then sweeps spread the reach through passable texels. The seed
 * shader decides what passes; the chroma key and the Mask's Key shape each bring
 * their own. Leaves the framebuffer, viewport and program changed.
 */
export class ReachFill {
	#gl: WebGL2RenderingContext;
	#seedFrag: string;
	#failed = false;
	#state: {
		seed: KeyProgram;
		spread: KeyProgram;
		tex: [WebGLTexture, WebGLTexture];
		fbo: [WebGLFramebuffer, WebGLFramebuffer];
		w: number;
		h: number;
	} | null = null;

	constructor(gl: WebGL2RenderingContext, seedFrag: string) {
		this.#gl = gl;
		this.#seedFrag = seedFrag;
	}

	/** Size of the last fill, in texels. */
	get size(): { w: number; h: number } | null {
		return this.#state && { w: this.#state.w, h: this.#state.h };
	}

	/** The fill of `tex` (g = reached). `seed` sets the seed program's own uniforms. */
	run(
		tex: WebGLTexture,
		texW: number,
		texH: number,
		seed: (prog: KeyProgram, w: number, h: number) => void,
	): WebGLTexture | null {
		if (texW <= 0 || texH <= 0) return null;
		const k = Math.min(1, REACH_MAX / Math.max(texW, texH));
		const w = Math.max(1, Math.round(texW * k));
		const h = Math.max(1, Math.round(texH * k));
		const r = this.#ensure(w, h);
		if (!r) return null;
		const gl = this.#gl;
		gl.viewport(0, 0, w, h);

		gl.bindFramebuffer(gl.FRAMEBUFFER, r.fbo[0]);
		gl.useProgram(r.seed.program);
		const u = r.seed.uniforms;
		if (u["u_flipY"]) gl.uniform1f(u["u_flipY"], 1.0);
		seed(r.seed, w, h);
		if (u["u_seedRadius"]) {
			gl.uniform1f(
				u["u_seedRadius"],
				Math.max(1, SEED_RADIUS * Math.max(w, h)),
			);
		}
		if (u["u_reachSize"]) gl.uniform2f(u["u_reachSize"], w, h);
		gl.activeTexture(gl.TEXTURE0);
		gl.bindTexture(gl.TEXTURE_2D, tex);
		if (u["u_texture"]) gl.uniform1i(u["u_texture"], 0);
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

	#ensure(w: number, h: number) {
		if (this.#failed) return null;
		const gl = this.#gl;
		if (!this.#state) {
			try {
				const seed = compileKeyProgram(gl, this.#seedFrag);
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
		// Read with LINEAR, so the cut's rim ramps over a texel.
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

/** Where a chroma key's connected points cut, over the whole source frame. */
export class KeyReachPass {
	#gl: WebGL2RenderingContext;
	#fill: ReachFill;

	constructor(gl: WebGL2RenderingContext) {
		this.#gl = gl;
		this.#fill = new ReachFill(gl, KEY_REACH_SEED_FRAG);
	}

	/** The fill for this frame (g = reached), or null when no point is connected. */
	run(
		tex: WebGLTexture,
		texW: number,
		texH: number,
		key: ChromaKey | undefined,
	): WebGLTexture | null {
		if (!hasConnectedPoint(key)) return null;
		return this.#fill.run(tex, texW, texH, (prog) =>
			setKeyPointUniforms(this.#gl, prog, key),
		);
	}

	/** Hands `reach` (from run) to a program built on CHROMA_KEY_GLSL. */
	bind(prog: KeyProgram, reach: WebGLTexture | null) {
		const gl = this.#gl;
		const u = prog.uniforms;
		if (u["u_hasReach"]) gl.uniform1f(u["u_hasReach"], reach ? 1 : 0);
		const size = this.#fill.size;
		if (!reach || !size) return;
		if (u["u_keyReachTexel"]) {
			gl.uniform2f(u["u_keyReachTexel"], 1 / size.w, 1 / size.h);
		}
		if (u["u_keyReach"]) {
			gl.activeTexture(gl.TEXTURE0 + REACH_UNIT);
			gl.bindTexture(gl.TEXTURE_2D, reach);
			gl.uniform1i(u["u_keyReach"], REACH_UNIT);
		}
	}

	dispose() {
		this.#fill.dispose();
	}
}
