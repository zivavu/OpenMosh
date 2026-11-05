/** GPU time per frame for the read-out, where the browser exposes it. */
export class GpuTimer {
	ms: number | null = null;
	#gl: WebGL2RenderingContext;
	#ext: { TIME_ELAPSED_EXT: number; GPU_DISJOINT_EXT: number } | null;
	#pending: WebGLQuery | null = null;
	#timing = false;

	constructor(gl: WebGL2RenderingContext) {
		this.#gl = gl;
		this.#ext = gl.getExtension("EXT_disjoint_timer_query_webgl2");
	}

	begin() {
		const gl = this.#gl;
		if (!this.#ext) return;
		if (this.#pending) {
			if (!gl.getQueryParameter(this.#pending, gl.QUERY_RESULT_AVAILABLE)) {
				return;
			}
			if (!gl.getParameter(this.#ext.GPU_DISJOINT_EXT)) {
				this.ms =
					(gl.getQueryParameter(this.#pending, gl.QUERY_RESULT) as number) /
					1e6;
			}
			gl.deleteQuery(this.#pending);
		}
		this.#pending = gl.createQuery()!;
		gl.beginQuery(this.#ext.TIME_ELAPSED_EXT, this.#pending);
		this.#timing = true;
	}

	end() {
		if (!this.#ext || !this.#timing) return;
		this.#gl.endQuery(this.#ext.TIME_ELAPSED_EXT);
		this.#timing = false;
	}
}
