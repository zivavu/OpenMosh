import {
	framebuffer,
	fullscreen,
	FULLSCREEN_VS,
	hexRgb,
	loc,
	program,
	setInks,
	texture,
} from "../../src/lib/generators/gpu";
import type { Colors } from "../../src/lib/generators/palette";
import { mulberry32 } from "../../src/lib/rng";
import {
	multiply,
	rotationAxis,
	translation,
	type Mat4,
} from "../../src/lib/mesh/mat4";
import { ARC_FLOATS, buildArcs, MAX_ARC_VERTICES, type ArcLook } from "./arcs";
import type { ControlFrame, Controls } from "./controls";
import { moodAt } from "./mood";
import {
	ARC_FS,
	ARC_VS,
	BRIGHT_FS,
	COMPOSITE_FS,
	COPY_FS,
	HDR_FS,
	POINTS_FS,
	POINTS_VS,
	PRESENT_FS,
	STREAK_FS,
} from "./shaders";

export interface Look extends ArcLook {
	exposure: number;
	gamma: number;
	bloom: number;
	glint: number;
	glintThreshold: number;
	glintLength: number;
	rays: number;
	focusBlur: number;
	dof: number;
	shutter: number;
	far: number;
	speed: number;
	speedReact: number;
	kickFlash: number;
	kickZoom: number;
	kickPush: number;
	kickRipple: number;
	bassSwell: number;
	midTwist: number;
	highSparkle: number;
	midWarp: number;
	dust: number;
}

/** Past this the picture stopped changing, by eye, up to 10M; below it costs nothing. */
const POINTS = 1e6;
/** Each point's light at the reference size, so the structure's brightness holds. */
const POINT_LIGHT = 0.075;
const FOV = (52 * Math.PI) / 180;
const FILM_SIDE = 960;
const STREAK_PASSES = 3;
const SPARKLE_TICKS_PER_SECOND = 30;
const RIPPLE_SPEED = 5;
const QUIET_LIGHT = 0.35;

interface Target {
	tex: WebGLTexture;
	fbo: WebGLFramebuffer;
}

function perspective(aspect: number): Mat4 {
	const near = 0.05;
	const far = 60;
	const f = (1 / Math.tan(FOV / 2)) * Math.min(1, aspect);
	const m = new Array<number>(16).fill(0);
	m[0] = f / aspect;
	m[5] = f;
	m[10] = (far + near) / (near - far);
	m[11] = -1;
	m[14] = (2 * far * near) / (near - far);
	return m;
}

/** Between the ramp's saturated and light stops, at full brightness. */
function glowTint(colors: Colors): number[] {
	const a = hexRgb(colors[2]);
	const b = hexRgb(colors[3]);
	const mid = a.map((v, i) => (v + b[i]) / 2);
	const top = Math.max(1, ...mid);
	return mid.map((v) => v / top);
}

export class MusicRenderer {
	readonly gl: WebGL2RenderingContext;
	private vao: WebGLVertexArrayObject;
	private arcVao: WebGLVertexArrayObject;
	private arcVbo: WebGLBuffer;
	private arcData = new Float32Array(MAX_ARC_VERTICES * ARC_FLOATS);
	private targets: Target[] = [];
	private dens!: Target;
	private hdr!: Target;
	private bright!: Target;
	private pingA!: Target;
	private pingB!: Target;
	private star!: Target;
	private comp!: Target;
	private w = 0;
	private h = 0;
	private timer: {
		ext: { TIME_ELAPSED_EXT: number; GPU_DISJOINT_EXT: number };
		pending: WebGLQuery | null;
	} | null;
	private timing = false;
	/** Last GPU time for a frame, in ms, where the browser exposes it. */
	gpuMs: number | null = null;
	/** Arc vertices in the last frame, for the read-out. */
	arcVertices = 0;

	constructor(private canvas: HTMLCanvasElement) {
		const gl = canvas.getContext("webgl2", {
			antialias: false,
			alpha: false,
			powerPreference: "high-performance",
		});
		if (!gl) throw new Error("WebGL2 unavailable");
		if (!gl.getExtension("EXT_color_buffer_float")) {
			throw new Error("No float render targets on this GPU");
		}
		this.gl = gl;
		this.vao = gl.createVertexArray()!;
		this.arcVbo = gl.createBuffer()!;
		this.arcVao = gl.createVertexArray()!;
		gl.bindVertexArray(this.arcVao);
		gl.bindBuffer(gl.ARRAY_BUFFER, this.arcVbo);
		gl.bufferData(gl.ARRAY_BUFFER, this.arcData.byteLength, gl.DYNAMIC_DRAW);
		const stride = ARC_FLOATS * 4;
		gl.enableVertexAttribArray(0);
		gl.vertexAttribPointer(0, 2, gl.FLOAT, false, stride, 0);
		gl.enableVertexAttribArray(1);
		gl.vertexAttribPointer(1, 1, gl.FLOAT, false, stride, 8);
		gl.enableVertexAttribArray(2);
		gl.vertexAttribPointer(2, 1, gl.FLOAT, false, stride, 12);
		gl.enableVertexAttribArray(3);
		gl.vertexAttribPointer(3, 1, gl.FLOAT, false, stride, 16);
		gl.enableVertexAttribArray(4);
		gl.vertexAttribPointer(4, 1, gl.FLOAT, false, stride, 20);
		gl.bindVertexArray(null);
		gl.bindBuffer(gl.ARRAY_BUFFER, null);
		const ext = gl.getExtension("EXT_disjoint_timer_query_webgl2");
		this.timer = ext ? { ext, pending: null } : null;
	}

	/** Compiles everything now, so a bad shader fails at load and not mid-song. */
	compile() {
		const { gl } = this;
		program(gl, POINTS_VS, POINTS_FS);
		program(gl, ARC_VS, ARC_FS);
		for (const fs of [
			HDR_FS,
			BRIGHT_FS,
			STREAK_FS,
			COPY_FS,
			COMPOSITE_FS,
			PRESENT_FS,
		]) {
			program(gl, FULLSCREEN_VS, fs);
		}
	}

	private target(
		w: number,
		h: number,
		internal: number,
		filter: number,
	): Target {
		const tex = texture(this.gl, w, h, internal, { filter });
		const target = { tex, fbo: framebuffer(this.gl, tex) };
		this.targets.push(target);
		return target;
	}

	private ensureSize(w: number, h: number) {
		const { gl } = this;
		if (w === this.w && h === this.h) return;
		for (const t of this.targets) {
			gl.deleteTexture(t.tex);
			gl.deleteFramebuffer(t.fbo);
		}
		this.targets = [];
		this.w = this.canvas.width = w;
		this.h = this.canvas.height = h;
		gl.activeTexture(gl.TEXTURE0);
		const half = [Math.max(1, w >> 1), Math.max(1, h >> 1)] as const;
		this.dens = this.target(w, h, gl.RGBA16F, gl.NEAREST);
		this.hdr = this.target(w, h, gl.RGBA16F, gl.LINEAR_MIPMAP_LINEAR);
		this.comp = this.target(w, h, gl.RGBA16F, gl.LINEAR_MIPMAP_LINEAR);
		this.bright = this.target(...half, gl.RGBA16F, gl.LINEAR);
		this.pingA = this.target(...half, gl.RGBA16F, gl.LINEAR);
		this.pingB = this.target(...half, gl.RGBA16F, gl.LINEAR);
		this.star = this.target(...half, gl.RGBA16F, gl.LINEAR);
	}

	private camera(f: ControlFrame, look: Look) {
		const rng = mulberry32(look.seed);
		const [yaw0, p0, p1, p2] = [rng(), rng(), rng(), rng()].map(
			(v) => v * Math.PI * 2,
		);
		const mood = moodAt(f, look.seed, look.variety);
		const travel = f.t * look.speed + f.energyTotal * look.speedReact;
		// Every hit knocks the camera a different way, and it settles back.
		const knock = mulberry32(look.seed ^ Math.imul(f.onsetIndex, 2654435761));
		const jolt = Math.exp(-f.kickAge * 5) * look.kickPush * look.variety;
		const yaw = yaw0 + mood.yaw + travel * 0.35 + (knock() - 0.5) * jolt * 0.7;
		const pitch =
			mood.pitch +
			0.4 * Math.sin(travel * 0.23 + p0) +
			(knock() - 0.5) * jolt * 0.5;
		const roll =
			mood.roll +
			0.2 * Math.sin(travel * 0.13 + p1) +
			(knock() - 0.5) * jolt * 0.5;
		const dist =
			(mood.dist + 0.7 * Math.sin(travel * 0.17 + p2)) *
			(1 - 0.3 * look.kickPush * f.kick);
		const view = multiply(
			translation(0, 0, -dist),
			multiply(
				rotationAxis(2, roll),
				multiply(rotationAxis(0, pitch), rotationAxis(1, yaw)),
			),
		);
		return {
			dist,
			roll,
			viewProj: multiply(perspective(this.w / this.h), view),
		};
	}

	private bindTex(
		p: WebGLProgram,
		name: string,
		unit: number,
		t: WebGLTexture,
	) {
		const { gl } = this;
		gl.activeTexture(gl.TEXTURE0 + unit);
		gl.bindTexture(gl.TEXTURE_2D, t);
		gl.uniform1i(loc(gl, p, name), unit);
	}

	private drawInto(target: Target | null, w: number, h: number) {
		const { gl } = this;
		gl.bindFramebuffer(gl.FRAMEBUFFER, target?.fbo ?? null);
		gl.viewport(0, 0, w, h);
		fullscreen(gl);
	}

	render(
		controls: Controls,
		now: ControlFrame,
		past: ControlFrame,
		look: Look,
		colors: Colors,
		w: number,
		h: number,
	) {
		const { gl } = this;
		this.ensureSize(w, h);
		this.beginTiming();

		const nowCam = this.camera(now, look);
		const pastCam = this.camera(past, look);
		const halfW = Math.max(1, w >> 1);
		const halfH = Math.max(1, h >> 1);

		// Points into the density buffer.
		const pts = program(gl, POINTS_VS, POINTS_FS);
		gl.useProgram(pts);
		gl.bindFramebuffer(gl.FRAMEBUFFER, this.dens.fbo);
		gl.viewport(0, 0, w, h);
		gl.clearColor(0, 0, 0, 0);
		gl.clear(gl.COLOR_BUFFER_BIT);
		gl.enable(gl.BLEND);
		gl.blendFunc(gl.ONE, gl.ONE);
		gl.uniformMatrix4fv(loc(gl, pts, "uNow"), false, nowCam.viewProj);
		gl.uniformMatrix4fv(loc(gl, pts, "uPast"), false, pastCam.viewProj);
		gl.uniform1i(loc(gl, pts, "uFormA"), now.formA);
		gl.uniform1i(loc(gl, pts, "uFormB"), now.formB);
		gl.uniform1f(loc(gl, pts, "uMix"), now.formMix);
		gl.uniform1ui(
			loc(gl, pts, "uSeed"),
			Math.imul(look.seed, 2654435761) >>> 0,
		);
		gl.uniform1ui(
			loc(gl, pts, "uSparkleTick"),
			Math.floor(now.t * SPARKLE_TICKS_PER_SECOND),
		);
		gl.uniform1f(loc(gl, pts, "uSwell"), now.bass * look.bassSwell);
		gl.uniform1f(loc(gl, pts, "uWaveR"), now.kickAge * RIPPLE_SPEED);
		gl.uniform1f(
			loc(gl, pts, "uWaveAmp"),
			look.kickRipple * Math.exp(-now.kickAge * 3),
		);
		gl.uniform1f(loc(gl, pts, "uTwist"), now.mid * look.midTwist);
		gl.uniform1f(loc(gl, pts, "uFar"), look.far);
		const side = Math.sqrt(w * h);
		// Lines are one pixel wide, so their light scales with the side, not the area.
		gl.uniform1f(loc(gl, pts, "uWeight"), POINT_LIGHT * (side / FILM_SIDE));
		gl.uniform1f(loc(gl, pts, "uFocus"), nowCam.dist);
		gl.uniform1f(loc(gl, pts, "uDof"), look.dof);
		gl.uniform1f(loc(gl, pts, "uResScale"), side / FILM_SIDE);
		gl.uniform1f(loc(gl, pts, "uSparkle"), now.high * look.highSparkle * 0.004);
		gl.uniform1f(
			loc(gl, pts, "uSpin"),
			(now.t * 0.25 + now.energyTotal * 1.4) * look.coreSpin,
		);
		gl.uniform1f(loc(gl, pts, "uBend"), now.mid * look.midTwist * 0.4);
		gl.uniform1f(
			loc(gl, pts, "uDustR"),
			1.5 * (0.55 + 0.7 * now.bass + 0.5 * now.kick),
		);
		const mood = moodAt(now, look.seed, look.variety);
		gl.uniform4fv(loc(gl, pts, "uShapeA"), mood.shapeA);
		gl.uniform4fv(loc(gl, pts, "uShapeB"), mood.shapeB);
		gl.uniform1f(loc(gl, pts, "uWarp"), now.mid * look.midWarp * mood.warp);
		gl.uniform1f(loc(gl, pts, "uWarpFreq"), mood.warpFreq);
		gl.uniform1f(loc(gl, pts, "uDust"), look.dust);
		gl.bindVertexArray(this.vao);
		gl.drawArrays(gl.POINTS, 0, POINTS);
		gl.disable(gl.BLEND);

		// Density to light, with the mips the bloom and the glints read.
		const hdr = program(gl, FULLSCREEN_VS, HDR_FS);
		gl.useProgram(hdr);
		setInks(gl, hdr, colors);
		this.bindTex(hdr, "uDens", 0, this.dens.tex);
		const light = QUIET_LIGHT + (1 - QUIET_LIGHT) * now.energy;
		gl.uniform1f(
			loc(gl, hdr, "uExposure"),
			look.exposure * light * (1 + look.kickFlash * now.kick),
		);
		this.drawInto(this.hdr, w, h);
		// Into the light before its mips, so bloom and glints pick the arcs up too.
		this.drawArcs(
			controls,
			now,
			look,
			colors,
			nowCam.viewProj,
			nowCam.dist,
			w,
			h,
		);
		gl.activeTexture(gl.TEXTURE0);
		gl.bindTexture(gl.TEXTURE_2D, this.hdr.tex);
		gl.generateMipmap(gl.TEXTURE_2D);

		this.drawGlints(look, now, nowCam.roll, halfW, halfH);

		const comp = program(gl, FULLSCREEN_VS, COMPOSITE_FS);
		gl.useProgram(comp);
		this.bindTex(comp, "uHdr", 0, this.hdr.tex);
		this.bindTex(comp, "uStar", 1, this.star.tex);
		gl.uniform2f(loc(gl, comp, "uRes"), w, h);
		gl.uniform1f(loc(gl, comp, "uBloom"), look.bloom);
		gl.uniform1f(loc(gl, comp, "uGlint"), look.glint);
		gl.uniform3fv(loc(gl, comp, "uTint"), glowTint(colors));
		this.drawInto(this.comp, w, h);
		gl.activeTexture(gl.TEXTURE1);
		gl.bindTexture(gl.TEXTURE_2D, null);
		gl.activeTexture(gl.TEXTURE0);
		gl.bindTexture(gl.TEXTURE_2D, this.comp.tex);
		gl.generateMipmap(gl.TEXTURE_2D);

		const present = program(gl, FULLSCREEN_VS, PRESENT_FS);
		gl.useProgram(present);
		this.bindTex(present, "uComp", 0, this.comp.tex);
		gl.uniform2f(loc(gl, present, "uRes"), w, h);
		gl.uniform1f(loc(gl, present, "uZoom"), look.kickZoom * now.kick);
		gl.uniform1f(loc(gl, present, "uFocusBlur"), look.focusBlur);
		gl.uniform1f(loc(gl, present, "uGamma"), look.gamma);
		this.drawInto(null, w, h);
		this.endTiming();
	}

	private drawArcs(
		controls: Controls,
		now: ControlFrame,
		look: Look,
		colors: Colors,
		viewProj: Mat4,
		focus: number,
		w: number,
		h: number,
	) {
		const { gl } = this;
		const vertices = buildArcs(
			this.arcData,
			now,
			controls,
			look,
			viewProj,
			focus,
			w,
			h,
		);
		this.arcVertices = vertices;
		if (vertices === 0) return;
		const arc = program(gl, ARC_VS, ARC_FS);
		gl.useProgram(arc);
		setInks(gl, arc, colors);
		gl.bindFramebuffer(gl.FRAMEBUFFER, this.hdr.fbo);
		gl.viewport(0, 0, w, h);
		gl.bindVertexArray(this.arcVao);
		gl.bindBuffer(gl.ARRAY_BUFFER, this.arcVbo);
		gl.bufferSubData(
			gl.ARRAY_BUFFER,
			0,
			this.arcData,
			0,
			vertices * ARC_FLOATS,
		);
		gl.enable(gl.BLEND);
		gl.blendFunc(gl.ONE, gl.ONE);
		gl.drawArrays(gl.TRIANGLES, 0, vertices);
		gl.disable(gl.BLEND);
		gl.bindBuffer(gl.ARRAY_BUFFER, null);
		gl.bindVertexArray(this.vao);
	}

	private drawGlints(
		look: Look,
		now: ControlFrame,
		roll: number,
		w: number,
		h: number,
	) {
		const { gl } = this;
		const bright = program(gl, FULLSCREEN_VS, BRIGHT_FS);
		gl.useProgram(bright);
		this.bindTex(bright, "uSrc", 0, this.hdr.tex);
		gl.uniform2f(loc(gl, bright, "uRes"), w, h);
		gl.uniform1f(loc(gl, bright, "uThreshold"), look.glintThreshold);
		this.drawInto(this.bright, w, h);

		gl.bindFramebuffer(gl.FRAMEBUFFER, this.star.fbo);
		gl.viewport(0, 0, w, h);
		gl.clearColor(0, 0, 0, 1);
		gl.clear(gl.COLOR_BUFFER_BIT);

		const streak = program(gl, FULLSCREEN_VS, STREAK_FS);
		const copy = program(gl, FULLSCREEN_VS, COPY_FS);
		const axes = Math.max(1, Math.round(look.rays / 2));
		const reach = look.glintLength * (1 + 0.5 * now.kick);
		for (let axis = 0; axis < axes; axis++) {
			// Turns with the music: fixed angles read as a sticker on the middle.
			const turn = (now.t * 0.1 + now.energyTotal * 0.6) * look.coreSpin;
			const angle = roll + turn + 0.35 + (axis * Math.PI) / axes;
			const dx = Math.cos(angle) / w;
			const dy = Math.sin(angle) / h;
			gl.useProgram(streak);
			gl.uniform2f(loc(gl, streak, "uRes"), w, h);
			gl.uniform1f(loc(gl, streak, "uFade"), 0.8);
			let src = this.bright;
			let dst = this.pingA;
			for (let pass = 0; pass < STREAK_PASSES; pass++) {
				const stride = reach * 4 ** pass;
				this.bindTex(streak, "uSrc", 0, src.tex);
				gl.uniform2f(loc(gl, streak, "uStep"), dx * stride, dy * stride);
				this.drawInto(dst, w, h);
				src = dst;
				dst = dst === this.pingA ? this.pingB : this.pingA;
			}
			gl.useProgram(copy);
			this.bindTex(copy, "uSrc", 0, src.tex);
			gl.uniform2f(loc(gl, copy, "uRes"), w, h);
			gl.enable(gl.BLEND);
			gl.blendFunc(gl.ONE, gl.ONE);
			this.drawInto(this.star, w, h);
			gl.disable(gl.BLEND);
		}
	}

	private beginTiming() {
		const { gl, timer } = this;
		if (!timer) return;
		if (timer.pending) {
			const ready = gl.getQueryParameter(
				timer.pending,
				gl.QUERY_RESULT_AVAILABLE,
			);
			if (!ready) return;
			if (!gl.getParameter(timer.ext.GPU_DISJOINT_EXT)) {
				this.gpuMs =
					(gl.getQueryParameter(timer.pending, gl.QUERY_RESULT) as number) /
					1e6;
			}
			gl.deleteQuery(timer.pending);
		}
		timer.pending = gl.createQuery()!;
		gl.beginQuery(timer.ext.TIME_ELAPSED_EXT, timer.pending);
		this.timing = true;
	}

	private endTiming() {
		if (!this.timer || !this.timing) return;
		this.gl.endQuery(this.timer.ext.TIME_ELAPSED_EXT);
		this.timing = false;
	}
}
