import { depthRange, type MeshCamera } from "../mesh/camera";
import type { Mesh, Skin } from "../mesh";
import { createProgram, getUniformLocations } from "./utils";

// Same world as the transform-3d shader: x right, y down, z away from the camera.
const MESH_VERT = `#version 300 es
precision highp float;
precision highp sampler2D;
layout(location = 0) in vec3 a_position;
layout(location = 1) in vec3 a_normal;
layout(location = 2) in vec3 a_color;
layout(location = 3) in vec3 a_uv;
layout(location = 4) in uvec4 a_joints;
layout(location = 5) in vec4 a_weights;
uniform sampler2D u_bones;
uniform bool u_skinned;
uniform mat3 u_rotation;
uniform float u_radius;
uniform float u_distance;
uniform float u_focal;
uniform vec2 u_half;
uniform vec2 u_depth;
out vec3 v_normal;
out vec3 v_color;
out vec3 v_world;
out vec3 v_uv;
mat4 bone(uint j) {
  int x = int(j) * 4;
  return mat4(
    texelFetch(u_bones, ivec2(x, 0), 0),
    texelFetch(u_bones, ivec2(x + 1, 0), 0),
    texelFetch(u_bones, ivec2(x + 2, 0), 0),
    texelFetch(u_bones, ivec2(x + 3, 0), 0));
}
void main() {
  vec3 pos = a_position;
  vec3 nrm = a_normal;
  if (u_skinned) {
    mat4 m = a_weights.x * bone(a_joints.x) + a_weights.y * bone(a_joints.y)
           + a_weights.z * bone(a_joints.z) + a_weights.w * bone(a_joints.w);
    pos = (m * vec4(a_position, 1.0)).xyz;
    nrm = mat3(m) * a_normal;
  }
  // Model files are y up with their front facing +z; the frame is y down, looking +z.
  vec3 flip = vec3(1.0, -1.0, -1.0);
  vec3 w = u_rotation * (pos * flip * u_radius) + vec3(0.0, 0.0, u_distance);
  v_normal = u_rotation * (nrm * flip);
  v_color = a_color;
  v_uv = a_uv;
  v_world = w;
  gl_Position = vec4(u_focal * w.x / u_half.x, u_focal * w.y / u_half.y, u_depth.x * w.z + u_depth.y, w.z);
}`;

const MESH_FRAG = `#version 300 es
precision highp float;
in vec3 v_normal;
in vec3 v_color;
in vec3 v_world;
in vec3 v_uv;
uniform sampler2D u_texture;
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
  vec3 base = v_color;
  if (v_uv.z > 0.5) base *= texture(u_texture, v_uv.xy).rgb;
  outColor = vec4(base * (0.28 + 0.8 * diffuse) + spec, 1.0);
}`;

/** What a mesh with no colours of its own is drawn in. */
const DEFAULT_COLOR = 0.82;

/** Units the pass binds its textures to, so unit 0 stays as the renderer left it. */
const BONE_UNIT = 1;
const TEXTURE_UNIT = 2;

interface GpuMesh {
	vao: WebGLVertexArrayObject;
	buffers: WebGLBuffer[];
	count: number;
	extent: [number, number, number];
	texture: WebGLTexture | null;
	skin: { skin: Skin; bones: WebGLTexture; matrices: Float32Array } | null;
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

	/** The uploaded model's `Mesh.extent`; null before it's uploaded. */
	extent(id: string): [number, number, number] | null {
		return this.#meshes.get(id)?.extent ?? null;
	}

	upload(id: string, mesh: Mesh) {
		if (this.#meshes.has(id)) return;
		const gl = this.#gl;
		const vao = gl.createVertexArray();
		if (!vao) return;
		gl.bindVertexArray(vao);
		const vertices = mesh.positions.length / 3;
		const skin = mesh.skin;
		const buffers = [
			this.#attribute(0, skin?.bindPositions ?? mesh.positions, 3),
			this.#attribute(1, mesh.normals, 3),
			this.#attribute(
				2,
				mesh.colors ?? new Float32Array(vertices * 3).fill(DEFAULT_COLOR),
				3,
			),
			this.#attribute(3, mesh.uvs ?? new Float32Array(vertices * 3), 3),
		];
		if (skin) {
			const joints = gl.createBuffer()!;
			gl.bindBuffer(gl.ARRAY_BUFFER, joints);
			gl.bufferData(gl.ARRAY_BUFFER, skin.joints, gl.STATIC_DRAW);
			gl.enableVertexAttribArray(4);
			gl.vertexAttribIPointer(4, 4, gl.UNSIGNED_SHORT, 0, 0);
			buffers.push(joints, this.#attribute(5, skin.weights, 4));
		}
		gl.bindVertexArray(null);
		this.#meshes.set(id, {
			vao,
			buffers,
			count: mesh.triangles * 3,
			extent: mesh.extent,
			texture: mesh.texture ? this.#colorTexture(mesh.texture) : null,
			skin: skin
				? {
						skin,
						bones: this.#boneTexture(),
						matrices: new Float32Array(skin.bones * 16),
					}
				: null,
		});
	}

	#attribute(loc: number, data: Float32Array, size: number): WebGLBuffer {
		const gl = this.#gl;
		const buf = gl.createBuffer()!;
		gl.bindBuffer(gl.ARRAY_BUFFER, buf);
		gl.bufferData(gl.ARRAY_BUFFER, data, gl.STATIC_DRAW);
		gl.enableVertexAttribArray(loc);
		gl.vertexAttribPointer(loc, size, gl.FLOAT, false, 0, 0);
		return buf;
	}

	#colorTexture(image: ImageBitmap): WebGLTexture {
		const gl = this.#gl;
		const tex = gl.createTexture()!;
		gl.activeTexture(gl.TEXTURE0 + TEXTURE_UNIT);
		gl.bindTexture(gl.TEXTURE_2D, tex);
		gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false);
		gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, image);
		gl.generateMipmap(gl.TEXTURE_2D);
		gl.texParameteri(
			gl.TEXTURE_2D,
			gl.TEXTURE_MIN_FILTER,
			gl.LINEAR_MIPMAP_LINEAR,
		);
		gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
		gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.REPEAT);
		gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.REPEAT);
		gl.activeTexture(gl.TEXTURE0);
		return tex;
	}

	/** A bone's matrix is four RGBA32F texels, read with texelFetch: no filtering. */
	#boneTexture(): WebGLTexture {
		const gl = this.#gl;
		const tex = gl.createTexture()!;
		gl.activeTexture(gl.TEXTURE0 + BONE_UNIT);
		gl.bindTexture(gl.TEXTURE_2D, tex);
		gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
		gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
		gl.activeTexture(gl.TEXTURE0);
		return tex;
	}

	drop(id: string) {
		const held = this.#meshes.get(id);
		if (!held) return;
		const gl = this.#gl;
		gl.deleteVertexArray(held.vao);
		for (const buf of held.buffers) gl.deleteBuffer(buf);
		if (held.texture) gl.deleteTexture(held.texture);
		if (held.skin) gl.deleteTexture(held.skin.bones);
		this.#meshes.delete(id);
	}

	/** Clears `tex` (w x h) and draws the mesh into it, posed `time` seconds into its
	 * animation. `half` is the screen box the texture covers, in the frame's
	 * half-height units. False when it couldn't. */
	draw(
		id: string,
		tex: WebGLTexture,
		w: number,
		h: number,
		camera: MeshCamera,
		half: { x: number; y: number },
		time: number,
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
		gl.uniform2f(u["u_half"], half.x, half.y);
		gl.uniform2f(
			u["u_depth"],
			(far + near) / (far - near),
			(-2 * far * near) / (far - near),
		);
		gl.uniform1i(u["u_bones"], BONE_UNIT);
		gl.uniform1i(u["u_texture"], TEXTURE_UNIT);
		gl.uniform1i(u["u_skinned"], mesh.skin ? 1 : 0);
		if (mesh.skin) {
			const { skin, bones, matrices } = mesh.skin;
			skin.pose(time, matrices);
			gl.activeTexture(gl.TEXTURE0 + BONE_UNIT);
			gl.bindTexture(gl.TEXTURE_2D, bones);
			gl.texImage2D(
				gl.TEXTURE_2D,
				0,
				gl.RGBA32F,
				skin.bones * 4,
				1,
				0,
				gl.RGBA,
				gl.FLOAT,
				matrices,
			);
		}
		if (mesh.texture) {
			gl.activeTexture(gl.TEXTURE0 + TEXTURE_UNIT);
			gl.bindTexture(gl.TEXTURE_2D, mesh.texture);
		}
		gl.activeTexture(gl.TEXTURE0);
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
