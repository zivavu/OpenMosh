import type { IndexFxManifest } from "./manifest";

/** The page a file shows when opened on its own: a small host that runs the effect's
 * passes the way the INDEX Playground does, over a test card or a dropped image or
 * video. Inside a host's frame it does nothing. It's inlined into each exported file
 * through toString(), so it can't reach anything outside its own body. */
export function standalonePreview(): void {
	if (window.parent !== window) return;
	const tool = (window as unknown as { INDEX_TOOL: IndexFxManifest })
		.INDEX_TOOL;
	const fx = tool.effect;
	const MAX_SIDE = 1600;

	const el = <K extends keyof HTMLElementTagNameMap>(
		tag: K,
		props: Record<string, unknown> = {},
		...children: (Node | string)[]
	) => {
		const node: HTMLElementTagNameMap[K] = document.createElement(tag);
		Object.assign(node, props);
		node.append(...children);
		return node;
	};

	const intro = document.getElementById("about");
	const stage = el("div", { className: "stage" });
	const canvas = el("canvas");
	const errorBox = el("p", { className: "error", hidden: true });
	stage.append(canvas, errorBox);
	const controls = el("div", { className: "controls" });
	const panel = el("aside", { className: "panel" });
	if (intro) panel.append(intro);
	document.body.append(stage, panel);

	const showError = (message: string) => {
		errorBox.hidden = false;
		errorBox.textContent = message;
	};

	const gl = canvas.getContext("webgl2", {
		alpha: false,
		antialias: false,
		depth: false,
		premultipliedAlpha: false,
		preserveDrawingBuffer: false,
	});
	if (!gl) {
		showError("This preview needs WebGL2, which this browser doesn't offer.");
		return;
	}

	const VERT = `#version 300 es
precision highp float;
out vec2 vUV;
void main() {
  vec2 p = vec2(gl_VertexID == 1 ? 3.0 : -1.0, gl_VertexID == 2 ? 3.0 : -1.0);
  vUV = (p + 1.0) * 0.5;
  gl_Position = vec4(p, 0.0, 1.0);
}`;
	const COPY = `#version 300 es
precision highp float;
in vec2 vUV;
uniform sampler2D uInput;
out vec4 outColor;
void main() { outColor = texture(uInput, vUV); }`;

	const compile = (type: number, code: string) => {
		const s = gl.createShader(type)!;
		gl.shaderSource(s, code);
		gl.compileShader(s);
		if (!gl.getShaderParameter(s, gl.COMPILE_STATUS))
			throw new Error(gl.getShaderInfoLog(s) || "shader didn't compile");
		return s;
	};
	const program = (fragment: string) => {
		const p = gl.createProgram()!;
		gl.attachShader(p, compile(gl.VERTEX_SHADER, VERT));
		gl.attachShader(p, compile(gl.FRAGMENT_SHADER, fragment));
		gl.linkProgram(p);
		if (!gl.getProgramParameter(p, gl.LINK_STATUS))
			throw new Error(gl.getProgramInfoLog(p) || "program didn't link");
		return p;
	};
	const texture = () => {
		const t = gl.createTexture()!;
		gl.bindTexture(gl.TEXTURE_2D, t);
		gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
		gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
		gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
		gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
		return t;
	};
	const target = () => ({ tex: texture(), fbo: gl.createFramebuffer()! });

	let programs: WebGLProgram[];
	let copy: WebGLProgram;
	try {
		programs = fx.passes.map((p) => program(p.fragment));
		copy = program(COPY);
	} catch (err) {
		showError(String((err as Error).message));
		return;
	}
	gl.bindVertexArray(gl.createVertexArray());
	const source = texture();
	const passTargets = fx.passes.map(target);
	const history = fx.history ? [target(), target()] : [];
	let historyIndex = 0;
	let seeded = false;
	let width = 0;
	let height = 0;

	const values: Record<string, number> = {};
	const colors: Record<string, string> = {};
	for (const p of tool.params) values[p.key] = p.default;
	for (const c of tool.colors) colors[c.key] = c.default;

	const row = (label: string, ...input: HTMLElement[]) =>
		el("label", { className: "row" }, el("span", {}, label), ...input);
	for (const p of tool.params) {
		if (p.type === "toggle") {
			const box = el("input", { type: "checkbox", checked: p.default > 0 });
			box.addEventListener(
				"change",
				() => (values[p.key] = box.checked ? 1 : 0),
			);
			controls.append(row(p.label, box));
		} else if (p.type === "choice" && p.options) {
			const select = el("select");
			for (const o of p.options)
				select.append(
					el("option", { value: String(o.value), textContent: o.label }),
				);
			select.value = String(p.default);
			select.addEventListener(
				"change",
				() => (values[p.key] = Number(select.value)),
			);
			controls.append(row(p.label, select));
		} else {
			const out = el("output", { textContent: String(p.default) });
			const range = el("input", {
				type: "range",
				min: String(p.min),
				max: String(p.max),
				step: String(p.step),
				value: String(p.default),
			});
			range.addEventListener("input", () => {
				values[p.key] = Number(range.value);
				out.textContent = range.value;
			});
			controls.append(row(p.label, range, out));
		}
	}
	for (const c of tool.colors) {
		const pick = el("input", { type: "color", value: c.default.toLowerCase() });
		pick.addEventListener("input", () => (colors[c.key] = pick.value));
		controls.append(row(c.label, pick));
	}

	let playing = true;
	let bypass = false;
	const play = el("button", { type: "button", textContent: "Pause" });
	play.addEventListener("click", () => {
		playing = !playing;
		play.textContent = playing ? "Pause" : "Play";
	});
	const bypassBox = el("input", { type: "checkbox" });
	bypassBox.addEventListener("change", () => (bypass = bypassBox.checked));
	const reset = el("button", { type: "button", textContent: "Reset" });
	reset.addEventListener("click", () => {
		seeded = false;
		clock = 0;
	});
	const fileInput = el("input", {
		type: "file",
		accept: "image/*,video/*",
		hidden: true,
	});
	const open = el("button", {
		type: "button",
		textContent: "Your image or video",
	});
	open.addEventListener("click", () => fileInput.click());
	const card = el("button", { type: "button", textContent: "Test card" });
	panel.append(
		controls,
		el("div", { className: "buttons" }, play, reset, open, card, fileInput),
		row("Bypass", bypassBox),
	);

	let media: HTMLImageElement | HTMLVideoElement | null = null;
	const load = (file: File | undefined) => {
		if (!file) return;
		const url = URL.createObjectURL(file);
		if (file.type.startsWith("video/")) {
			const video = el("video", {
				src: url,
				loop: true,
				muted: true,
				playsInline: true,
			});
			void video.play();
			media = video;
		} else {
			const img = el("img", { src: url });
			media = img;
		}
		seeded = false;
	};
	fileInput.addEventListener("change", () => load(fileInput.files?.[0]));
	card.addEventListener("click", () => {
		media = null;
		seeded = false;
	});
	window.addEventListener("dragover", (e) => e.preventDefault());
	window.addEventListener("drop", (e: DragEvent) => {
		e.preventDefault();
		load(e.dataTransfer?.files[0]);
	});

	const paper = document.createElement("canvas");
	const ctx = paper.getContext("2d")!;
	const testCard = (t: number) => {
		const w = paper.width;
		const h = paper.height;
		const s = Math.min(w, h);
		const sky = ctx.createLinearGradient(0, 0, w, h);
		sky.addColorStop(0, `hsl(${(t * 12) % 360} 70% 22%)`);
		sky.addColorStop(1, `hsl(${(t * 12 + 140) % 360} 75% 45%)`);
		ctx.fillStyle = sky;
		ctx.fillRect(0, 0, w, h);
		const bars = [
			"#c0c0c0",
			"#c0c000",
			"#00c0c0",
			"#00c000",
			"#c000c0",
			"#c00000",
			"#0000c0",
		];
		bars.forEach((c, i) => {
			ctx.fillStyle = c;
			ctx.fillRect((i * w) / 7, h * 0.62, w / 7 + 1, h * 0.14);
		});
		for (let i = 0; i < 24; i++) {
			ctx.fillStyle = i % 2 ? "#111" : "#eee";
			ctx.fillRect((i * w) / 24, h * 0.76, w / 24 + 1, h * 0.05);
		}
		for (let i = 0; i < 5; i++) {
			const x = w * (0.5 + 0.38 * Math.sin(t * (0.5 + i * 0.17) + i * 1.3));
			const y = h * (0.35 + 0.22 * Math.cos(t * (0.4 + i * 0.11) + i * 2.1));
			const r = s * (0.07 + 0.025 * i);
			const ball = ctx.createRadialGradient(
				x - r * 0.3,
				y - r * 0.3,
				r * 0.1,
				x,
				y,
				r,
			);
			ball.addColorStop(0, "#fff");
			ball.addColorStop(0.35, `hsl(${i * 72 + t * 20} 90% 60%)`);
			ball.addColorStop(1, `hsl(${i * 72 + t * 20} 90% 25%)`);
			ctx.fillStyle = ball;
			ctx.beginPath();
			ctx.arc(x, y, r, 0, Math.PI * 2);
			ctx.fill();
		}
		ctx.save();
		ctx.translate(w * 0.5, h * 0.9);
		ctx.font = `800 ${Math.round(s * 0.09)}px system-ui, sans-serif`;
		ctx.textAlign = "center";
		ctx.textBaseline = "middle";
		ctx.fillStyle = "#fff";
		ctx.fillText(tool.name.toUpperCase(), 0, 0);
		ctx.restore();
	};
	const drawMedia = (m: HTMLImageElement | HTMLVideoElement) => {
		const mw = m instanceof HTMLVideoElement ? m.videoWidth : m.naturalWidth;
		const mh = m instanceof HTMLVideoElement ? m.videoHeight : m.naturalHeight;
		ctx.fillStyle = "#000";
		ctx.fillRect(0, 0, paper.width, paper.height);
		if (!mw || !mh) return;
		const k = Math.max(paper.width / mw, paper.height / mh);
		ctx.drawImage(
			m,
			(paper.width - mw * k) / 2,
			(paper.height - mh * k) / 2,
			mw * k,
			mh * k,
		);
	};

	const allocate = (t: { tex: WebGLTexture; fbo: WebGLFramebuffer }) => {
		gl.bindTexture(gl.TEXTURE_2D, t.tex);
		gl.texImage2D(
			gl.TEXTURE_2D,
			0,
			gl.RGBA8,
			width,
			height,
			0,
			gl.RGBA,
			gl.UNSIGNED_BYTE,
			null,
		);
		gl.bindFramebuffer(gl.FRAMEBUFFER, t.fbo);
		gl.framebufferTexture2D(
			gl.FRAMEBUFFER,
			gl.COLOR_ATTACHMENT0,
			gl.TEXTURE_2D,
			t.tex,
			0,
		);
	};
	const resize = () => {
		const box = stage.getBoundingClientRect();
		const dpr = Math.min(devicePixelRatio || 1, 2);
		const k = Math.min(
			1,
			MAX_SIDE / Math.max(box.width * dpr, box.height * dpr, 1),
		);
		const w = Math.max(1, Math.round(box.width * dpr * k));
		const h = Math.max(1, Math.round(box.height * dpr * k));
		if (w === width && h === height) return;
		width = canvas.width = paper.width = w;
		height = canvas.height = paper.height = h;
		for (const t of [...passTargets, ...history]) allocate(t);
		seeded = false;
	};
	new ResizeObserver(resize).observe(stage);

	const bind = (
		prog: WebGLProgram,
		unit: number,
		name: string,
		tex: WebGLTexture,
	) => {
		gl.activeTexture(gl.TEXTURE0 + unit);
		gl.bindTexture(gl.TEXTURE_2D, tex);
		const at = gl.getUniformLocation(prog, name);
		if (at) gl.uniform1i(at, unit);
	};
	const blit = (tex: WebGLTexture, fbo: WebGLFramebuffer | null) => {
		gl.useProgram(copy);
		bind(copy, 0, "uInput", tex);
		gl.bindFramebuffer(gl.FRAMEBUFFER, fbo);
		gl.viewport(0, 0, width, height);
		gl.drawArrays(gl.TRIANGLES, 0, 3);
	};

	let clock = 0;
	let last = 0;
	let frame = 0;
	const tick = (now: number) => {
		requestAnimationFrame(tick);
		resize();
		if (!width || !height) return;
		const delta = playing && last ? Math.min(0.05, (now - last) / 1000) : 0;
		last = now;
		clock += delta;
		if (playing || !media) {
			if (media) drawMedia(media);
			else testCard(clock);
		}
		gl.bindTexture(gl.TEXTURE_2D, source);
		gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, true);
		gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, paper);
		gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false);
		if (bypass) {
			blit(source, null);
			return;
		}
		if (fx.history && !seeded) {
			for (const t of history) blit(source, t.fbo);
			seeded = true;
		}
		let current = source;
		programs.forEach((prog, i) => {
			gl.useProgram(prog);
			bind(prog, 0, "uInput", current);
			bind(
				prog,
				1,
				"uHistory",
				fx.history ? history[historyIndex].tex : source,
			);
			const set = (name: string, f: (at: WebGLUniformLocation) => void) => {
				const at = gl.getUniformLocation(prog, name);
				if (at) f(at);
			};
			set("uResolution", (at) => gl.uniform2f(at, width, height));
			set("uTime", (at) => gl.uniform1f(at, clock));
			set("uDelta", (at) => gl.uniform1f(at, delta));
			set("uFrame", (at) => gl.uniform1i(at, frame));
			for (const p of tool.params)
				set(`u_${p.key}`, (at) => gl.uniform1f(at, values[p.key]));
			for (const c of tool.colors) {
				const hex = colors[c.key];
				const rgb = [1, 3, 5].map(
					(k) => parseInt(hex.slice(k, k + 2), 16) / 255,
				);
				set(`u_${c.key}`, (at) => gl.uniform4f(at, rgb[0], rgb[1], rgb[2], 1));
			}
			gl.bindFramebuffer(gl.FRAMEBUFFER, passTargets[i].fbo);
			gl.viewport(0, 0, width, height);
			gl.drawArrays(gl.TRIANGLES, 0, 3);
			current = passTargets[i].tex;
		});
		if (delta > 0) {
			if (fx.history) {
				historyIndex = 1 - historyIndex;
				blit(current, history[historyIndex].fbo);
			}
			frame++;
		}
		blit(current, null);
	};
	requestAnimationFrame(tick);
}
