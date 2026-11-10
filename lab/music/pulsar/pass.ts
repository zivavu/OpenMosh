/** Draws Pulsar: a light field fed back on itself in small steps of song time, then
 * blurred, bloomed and graded onto the canvas. */

import {
	framebuffer,
	fullscreen,
	FULLSCREEN_VS,
	loc,
	program,
	setInks,
	texture,
} from "../../../src/lib/generators/gpu";
import type { Colors } from "../../../src/lib/generators/palette";
import type { PulsarLook } from "./look";
import { FEED_FS, POST_FS } from "./shaders";
import { samplePulsar, type PulsarTable } from "./table";

/** The longest feedback step while playing; a slower frame takes several. */
const STEP = 1 / 60;
/** After a seek or a redraw the trails are rebuilt from this far back... */
const WARM_SECONDS = 1.2;
/** ...in coarser steps, so a knob drag stays quick. */
const WARM_STEP = 1 / 30;
/** A jump longer than this is a seek, not a slow frame. */
const MAX_GAP = 0.25;

interface Target {
	tex: WebGLTexture;
	fbo: WebGLFramebuffer;
}

export class PulsarPass {
	private readonly gl: WebGL2RenderingContext;
	private feed: Target[] = [];
	private current = 0;
	/** The song time the light field holds; NaN when it holds nothing. */
	private fieldTime = NaN;
	private w = 0;
	private h = 0;
	readonly supported: boolean;
	/** Feedback steps in the last frame, for the read-out. */
	steps = 0;

	constructor(gl: WebGL2RenderingContext) {
		this.gl = gl;
		this.supported = !!gl.getExtension("EXT_color_buffer_float");
	}

	compile() {
		program(this.gl, FULLSCREEN_VS, FEED_FS);
		program(this.gl, FULLSCREEN_VS, POST_FS);
	}

	private ensureSize(w: number, h: number) {
		if (w === this.w && h === this.h) return;
		const { gl } = this;
		this.free();
		gl.activeTexture(gl.TEXTURE0);
		for (let i = 0; i < 2; i++) {
			const tex = texture(gl, w, h, gl.RGBA16F, {
				filter: gl.LINEAR_MIPMAP_LINEAR,
			});
			gl.generateMipmap(gl.TEXTURE_2D);
			this.feed.push({ tex, fbo: framebuffer(gl, tex) });
		}
		gl.bindTexture(gl.TEXTURE_2D, null);
		this.w = w;
		this.h = h;
		this.fieldTime = NaN;
	}

	private free() {
		for (const t of this.feed) {
			this.gl.deleteTexture(t.tex);
			this.gl.deleteFramebuffer(t.fbo);
		}
		this.feed = [];
		this.w = 0;
		this.h = 0;
	}

	draw(
		table: PulsarTable,
		t: number,
		look: PulsarLook,
		colors: Colors,
		w: number,
		h: number,
	) {
		const { gl } = this;
		if (!this.supported || table.frames === 0) return;
		this.ensureSize(w, h);
		gl.viewport(0, 0, w, h);

		// Only playing moves forward a step at a time; anything else rebuilds the trails.
		const resume = t > this.fieldTime && t - this.fieldTime <= MAX_GAP;
		if (!resume) {
			gl.clearColor(0, 0, 0, 0);
			for (const target of this.feed) {
				gl.bindFramebuffer(gl.FRAMEBUFFER, target.fbo);
				gl.clear(gl.COLOR_BUFFER_BIT);
			}
			this.fieldTime = Math.max(0, t - WARM_SECONDS);
		}
		const span = t - this.fieldTime;
		const steps = Math.max(1, Math.ceil(span / (resume ? STEP : WARM_STEP)));
		const feed = program(gl, FULLSCREEN_VS, FEED_FS);
		gl.useProgram(feed);
		gl.uniform2f(loc(gl, feed, "uRes"), w, h);
		gl.uniform1i(loc(gl, feed, "uPrev"), 0);
		gl.activeTexture(gl.TEXTURE0);
		for (let i = 1; i <= steps; i++) {
			const at = i === steps ? t : this.fieldTime + (span * i) / steps;
			this.step(feed, table, at, span / steps, look);
		}
		this.fieldTime = t;
		this.steps = steps;

		const field = this.feed[this.current];
		gl.bindTexture(gl.TEXTURE_2D, field.tex);
		gl.generateMipmap(gl.TEXTURE_2D);
		this.present(field.tex, table, t, look, colors, w, h);
		gl.bindTexture(gl.TEXTURE_2D, null);
	}

	private step(
		feed: WebGLProgram,
		table: PulsarTable,
		t: number,
		dt: number,
		look: PulsarLook,
	) {
		const { gl } = this;
		const m = samplePulsar(table, t);
		const sec = m.section;
		const fold = look.fold > 0 ? look.fold : sec.fold;
		const star = 1 + Math.floor(sec.star * Math.floor((fold - 1) / 2));
		const kick = m.kick * look.kickBurst;
		const hold = look.trail * (1 + look.kickTrail * m.kick);
		const set = (name: string, v: number) =>
			gl.uniform1f(loc(gl, feed, name), v);

		set("uT", t);
		set("uFlow", m.drift);
		set("uRot", m.drift * look.spin * 0.35);
		set(
			"uScale",
			look.size * (1 + 0.22 * m.bass * look.bassPulse + 0.1 * kick),
		);
		set("uBurst", kick);
		set("uFlash", m.flash * look.kickBurst);
		set("uWarp", look.warp * (0.25 + m.mid * look.midWarp));
		set("uMid", m.mid * look.midWarp);
		set("uSpark", m.high * look.highSpark);
		set("uLineW", look.lineWidth * (1 + 0.6 * kick));
		set("uLight", m.presence);
		set("uEnergy", m.energy);
		set("uFold", fold);
		set("uStep", star);
		set("uOrbits", sec.orbits);
		set("uSpin", sec.spin);
		set("uPhase", sec.phase);
		set("uCore", look.core);
		set("uRays", look.rays);
		set("uRings", look.rings);
		set("uOrbit", look.orbits);
		set("uFractal", look.fractal);
		set("uField", look.field);
		set("uKeep", hold > 1e-3 ? Math.exp(-dt / hold) : 0);
		set("uZoom", dt * (look.zoom * 0.4 + look.kickZoom * m.kick * 0.8));
		set("uTwist", dt * look.twist * sec.spin);
		set(
			"uSmear",
			dt * look.smear * (0.15 + 0.5 * m.energy + 1.2 * m.kick) * 0.5,
		);

		const from = this.feed[this.current];
		this.current = 1 - this.current;
		gl.bindFramebuffer(gl.FRAMEBUFFER, this.feed[this.current].fbo);
		gl.bindTexture(gl.TEXTURE_2D, from.tex);
		fullscreen(gl);
	}

	private present(
		field: WebGLTexture,
		table: PulsarTable,
		t: number,
		look: PulsarLook,
		colors: Colors,
		w: number,
		h: number,
	) {
		const { gl } = this;
		const m = samplePulsar(table, t);
		const post = program(gl, FULLSCREEN_VS, POST_FS);
		gl.useProgram(post);
		setInks(gl, post, colors);
		const set = (name: string, v: number) =>
			gl.uniform1f(loc(gl, post, name), v);
		gl.uniform2f(loc(gl, post, "uRes"), w, h);
		gl.uniform1i(loc(gl, post, "uFeed"), 0);
		set("uBlur", look.blur + look.kickBlur * m.kick);
		set("uChroma", look.chroma * (1 + m.kick) + look.highChroma * m.high);
		set("uBloom", look.bloom);
		set("uExposure", look.exposure);
		set("uMode", m.mode);
		set("uGrain", look.grain);
		set("uT", t);
		gl.activeTexture(gl.TEXTURE0);
		gl.bindTexture(gl.TEXTURE_2D, field);
		gl.bindFramebuffer(gl.FRAMEBUFFER, null);
		gl.viewport(0, 0, w, h);
		fullscreen(gl);
	}

	dispose() {
		this.free();
	}
}
