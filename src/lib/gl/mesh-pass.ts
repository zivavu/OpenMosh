import { depthRange, type MeshCamera } from "../mesh/camera";
import type { Mesh } from "../mesh";
import { createProgram, getUniformLocations } from "./utils";

// Same world as the transform-3d shader: x right, y down, z away from the camera.
const MESH_VERT = `#version 300 es
layout(location = 0) in vec3 a_position;
layout(location = 1) in vec3 a_normal;
layout(location = 2) in vec3 a_color;
uniform mat3 u_rotation;
uniform float u_radius;
uniform float u_distance;
uniform float u_focal;
uniform float u_aspect;
uniform vec2 u_depth;
out vec3 v_normal;
out vec3 v_color;
out vec3 v_world;
void main() {
  // Model files are y up with their front facing +z; the frame is y down, looking +z.
  vec3 flip = vec3(1.0, -1.0, -1.0);
  vec3 w = u_rotation * (a_position * flip * u_radius) + vec3(0.0, 0.0, u_distance);
  v_normal = u_rotation * (a_normal * flip);
  v_color = a_color;
  v_world = w;
  gl_Position = vec4(u_focal * w.x / u_aspect, u_focal * w.y, u_depth.x * w.z + u_depth.y, w.z);
}`;

const MESH_FRAG = `#version 300 es
precision highp float;
in vec3 v_normal;
in vec3 v_color;
in vec3 v_world;
out vec4 outColor;
void main() {
  vec3 n = normalize(v_normal);
  vec3 toEye = normalize(-v_world);
  // Two-sided: hand-made meshes often wind some faces backwards.
  if (dot(n, toEye) < 0.0) n = -n;
  // Up, left and in front of the camera, so a turning model shows it.
  vec3 light = normalize(vec3(-0.45, -0.65, -0.6));
  float diffuse = max(dot(n, light), 0.0);
  float spec = pow(max(dot(n, normalize(light + toEye)), 0.0), 32.0) * 0.25;
  outColor = vec4(v_color * (0.28 + 0.8 * diffuse) + spec, 1.0);
}`;

/** What a mesh with no colours of its own is drawn in. */
const DEFAULT_COLOR = 0.82;

interface GpuMesh {
	vao: WebGLVertexArrayObject;
	buffers: WebGLBuffer[];
	count: number;
}

/**
 * Draws meshes, depth-tested and multisampled, into a layer texture.
 * Leaves the framebuffer, viewport, program and vertex array changed.
 */
export class MeshPass {
	#gl: WebGL2RenderingContext;
	#program: {
		program: WebGLProgram;
		uniforms: Record<string, WebGLUniformLocation>;
	} | null = null;
	#failed = false;
	#meshes = new Map<string, GpuMesh>();
	#target: {
		msFbo: WebGLFramebuffer;
		color: WebGLRenderbuffer;
		depth: WebGLRenderbuffer;
		resolveFbo: WebGLFramebuffer;
		w: number;
		h: number;
	} | null = null;

	constructor(gl: WebGL2RenderingContext) {
		this.#gl = gl;
	}

	has(id: string): boolean {
		return this.#meshes.has(id);
	}

	upload(id: string, mesh: Mesh) {
		if (this.#meshes.has(id)) return;
		const gl = this.#gl;
		const vao = gl.createVertexArray();
		if (!vao) return;
		gl.bindVertexArray(vao);
		const colors =
			mesh.colors ??
			new Float32Array(mesh.positions.length).fill(DEFAULT_COLOR);
		const buffers = [mesh.positions, mesh.normals, colors].map((data, loc) => {
			const buf = gl.createBuffer()!;
			gl.bindBuffer(gl.ARRAY_BUFFER, buf);
			gl.bufferData(gl.ARRAY_BUFFER, data, gl.STATIC_DRAW);
			gl.enableVertexAttribArray(loc);
			gl.vertexAttribPointer(loc, 3, gl.FLOAT, false, 0, 0);
			return buf;
		});
		gl.bindVertexArray(null);
		this.#meshes.set(id, { vao, buffers, count: mesh.triangles * 3 });
	}

	drop(id: string) {
		const held = this.#meshes.get(id);
		if (!held) return;
		const gl = this.#gl;
		gl.deleteVertexArray(held.vao);
		for (const buf of held.buffers) gl.deleteBuffer(buf);
		this.#meshes.delete(id);
	}

	/** Clears `tex` (w x h) and draws the mesh into it. False when it couldn't. */
	draw(
		id: string,
		tex: WebGLTexture,
		w: number,
		h: number,
		camera: MeshCamera,
	): boolean {
		const mesh = this.#meshes.get(id);
		const prog = this.#ensureProgram();
		const target = this.#ensureTarget(w, h);
		if (!mesh || !prog || !target) return false;
		const gl = this.#gl;

		gl.bindFramebuffer(gl.FRAMEBUFFER, target.msFbo);
		gl.viewport(0, 0, w, h);
		gl.clearColor(0, 0, 0, 0);
		gl.clearDepth(1);
		gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
		gl.enable(gl.DEPTH_TEST);
		gl.depthFunc(gl.LESS);

		gl.useProgram(prog.program);
		const u = prog.uniforms;
		const { near, far } = depthRange(camera);
		gl.uniformMatrix3fv(u["u_rotation"], false, camera.rotation);
		gl.uniform1f(u["u_radius"], camera.radius);
		gl.uniform1f(u["u_distance"], camera.distance);
		gl.uniform1f(u["u_focal"], camera.focal);
		gl.uniform1f(u["u_aspect"], w / h);
		gl.uniform2f(
			u["u_depth"],
			(far + near) / (far - near),
			(-2 * far * near) / (far - near),
		);
		gl.bindVertexArray(mesh.vao);
		gl.drawArrays(gl.TRIANGLES, 0, mesh.count);
		gl.disable(gl.DEPTH_TEST);

		gl.bindFramebuffer(gl.DRAW_FRAMEBUFFER, target.resolveFbo);
		gl.framebufferTexture2D(
			gl.DRAW_FRAMEBUFFER,
			gl.COLOR_ATTACHMENT0,
			gl.TEXTURE_2D,
			tex,
			0,
		);
		gl.bindFramebuffer(gl.READ_FRAMEBUFFER, target.msFbo);
		gl.blitFramebuffer(0, 0, w, h, 0, 0, w, h, gl.COLOR_BUFFER_BIT, gl.NEAREST);
		gl.bindFramebuffer(gl.FRAMEBUFFER, null);
		return true;
	}

	#ensureProgram() {
		if (this.#program || this.#failed) return this.#program;
		try {
			const program = createProgram(this.#gl, MESH_VERT, MESH_FRAG);
			this.#program = {
				program,
				uniforms: getUniformLocations(this.#gl, program),
			};
		} catch (err) {
			this.#failed = true;
			console.error(err);
		}
		return this.#program;
	}

	#ensureTarget(w: number, h: number) {
		if (this.#target?.w === w && this.#target.h === h) return this.#target;
		this.#deleteTarget();
		const gl = this.#gl;
		const samples = Math.min(4, gl.getParameter(gl.MAX_SAMPLES) as number);
		const msFbo = gl.createFramebuffer();
		const color = gl.createRenderbuffer();
		const depth = gl.createRenderbuffer();
		const resolveFbo = gl.createFramebuffer();
		if (!msFbo || !color || !depth || !resolveFbo) return null;
		gl.bindRenderbuffer(gl.RENDERBUFFER, color);
		gl.renderbufferStorageMultisample(gl.RENDERBUFFER, samples, gl.RGBA8, w, h);
		gl.bindRenderbuffer(gl.RENDERBUFFER, depth);
		gl.renderbufferStorageMultisample(
			gl.RENDERBUFFER,
			samples,
			gl.DEPTH_COMPONENT24,
			w,
			h,
		);
		gl.bindFramebuffer(gl.FRAMEBUFFER, msFbo);
		gl.framebufferRenderbuffer(
			gl.FRAMEBUFFER,
			gl.COLOR_ATTACHMENT0,
			gl.RENDERBUFFER,
			color,
		);
		gl.framebufferRenderbuffer(
			gl.FRAMEBUFFER,
			gl.DEPTH_ATTACHMENT,
			gl.RENDERBUFFER,
			depth,
		);
		gl.bindFramebuffer(gl.FRAMEBUFFER, null);
		this.#target = { msFbo, color, depth, resolveFbo, w, h };
		return this.#target;
	}

	#deleteTarget() {
		const t = this.#target;
		if (!t) return;
		const gl = this.#gl;
		gl.deleteFramebuffer(t.msFbo);
		gl.deleteFramebuffer(t.resolveFbo);
		gl.deleteRenderbuffer(t.color);
		gl.deleteRenderbuffer(t.depth);
		this.#target = null;
	}

	dispose() {
		for (const id of [...this.#meshes.keys()]) this.drop(id);
		this.#deleteTarget();
		if (this.#program) this.#gl.deleteProgram(this.#program.program);
		this.#program = null;
	}
}
