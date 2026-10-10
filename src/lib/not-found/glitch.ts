// The 404's lettering, moshed on a 2D canvas: channel split, slipped bands,
// smeared columns and dragged blocks. Idle it twitches now and then; pointer
// movement and a mosh heat it up.

export interface Glitch {
	/** Rolls a new look and fires a burst, like the editor's mosh key. */
	mosh(): void;
	disturb(amount: number): void;
	destroy(): void;
}

interface Scar {
	y: number;
	h: number;
	dx: number;
	smearX: number | null;
	smearRight: boolean;
}

const FRAME_MS = 1000 / 24;
const FONT = '"Archivo Variable", system-ui, sans-serif';
const CHANNELS = ["#c6a2ea", "#6ee7c0"] as const;

export function glitchText(canvas: HTMLCanvasElement, text: string): Glitch {
	const ctx = canvas.getContext("2d")!;
	const buf = document.createElement("canvas");
	const bufCtx = buf.getContext("2d")!;
	const glyphs = { white: layer(), mosh: layer(), live: layer() };

	let w = 0;
	let h = 0;
	let heat = 1;
	let nextTwitch = 0;
	let last = 0;
	let raf = 0;
	let ready = false;
	let scars: Scar[] = [];

	function layer() {
		const c = document.createElement("canvas");
		return { canvas: c, ctx: c.getContext("2d")! };
	}

	function layout() {
		const dpr = Math.min(devicePixelRatio || 1, 2);
		w = Math.round(canvas.clientWidth * dpr);
		h = Math.round(canvas.clientHeight * dpr);
		if (!w || !h) return;
		for (const c of [
			canvas,
			buf,
			...Object.values(glyphs).map((g) => g.canvas),
		]) {
			c.width = w;
			c.height = h;
		}

		const probe = glyphs.white.ctx;
		probe.font = `900 100px ${FONT}`;
		const m = probe.measureText(text);
		const capHeight = m.actualBoundingBoxAscent + m.actualBoundingBoxDescent;
		const size = 100 * Math.min((w * 0.86) / m.width, (h * 0.78) / capHeight);
		const baseline =
			h / 2 +
			((m.actualBoundingBoxAscent - m.actualBoundingBoxDescent) / 2) *
				(size / 100);

		const fills = { white: "#ececf0", mosh: CHANNELS[0], live: CHANNELS[1] };
		for (const [key, g] of Object.entries(glyphs)) {
			g.ctx.clearRect(0, 0, w, h);
			g.ctx.font = `900 ${size}px ${FONT}`;
			g.ctx.textAlign = "center";
			g.ctx.textBaseline = "alphabetic";
			g.ctx.fillStyle = fills[key as keyof typeof fills];
			g.ctx.fillText(text, w / 2, baseline);
		}
		rollScars();
	}

	function rollScars() {
		const count = 1 + Math.floor(Math.random() * 3);
		scars = Array.from({ length: count }, () => {
			const bandH = h * (0.04 + Math.random() * 0.1);
			return {
				y: h * 0.15 + Math.random() * (h * 0.7 - bandH),
				h: bandH,
				dx: (Math.random() - 0.5) * w * 0.12,
				smearX: Math.random() < 0.45 ? w * (0.2 + Math.random() * 0.6) : null,
				smearRight: Math.random() < 0.6,
			};
		});
	}

	function draw() {
		const jolt = heat * heat;
		const split = (1.5 + jolt * 18 * Math.random()) * (w / 640);
		const lift = (Math.random() - 0.5) * jolt * h * 0.03;

		bufCtx.clearRect(0, 0, w, h);
		bufCtx.globalCompositeOperation = "lighter";
		bufCtx.drawImage(glyphs.mosh.canvas, -split, lift);
		bufCtx.drawImage(glyphs.live.canvas, split, -lift);
		bufCtx.globalCompositeOperation = "source-over";
		bufCtx.drawImage(glyphs.white.canvas, 0, 0);

		ctx.clearRect(0, 0, w, h);
		for (let y = 0; y < h;) {
			const bandH = Math.min(
				h - y,
				Math.ceil(h * (0.02 + Math.random() * 0.14)),
			);
			const slip =
				Math.random() < jolt * 0.55
					? (Math.random() - 0.5) * w * 0.3 * jolt
					: 0;
			ctx.drawImage(buf, 0, y, w, bandH, slip, y, w, bandH);
			y += bandH;
		}

		for (const s of scars) {
			ctx.clearRect(0, s.y, w, s.h);
			ctx.drawImage(buf, 0, s.y, w, s.h, s.dx, s.y, w, s.h);
			if (s.smearX !== null) smear(s.smearX, s.y, s.h, 0.9, s.smearRight);
		}

		if (Math.random() < jolt * 0.6) {
			const bandH = h * (0.03 + Math.random() * 0.12);
			smear(
				w * (0.15 + Math.random() * 0.7),
				Math.random() * (h - bandH),
				bandH,
				0.8,
				Math.random() < 0.6,
			);
		}

		const blocks = Math.floor(jolt * 5 * Math.random());
		for (let i = 0; i < blocks; i++) {
			const cell = Math.max(8, Math.round(w / 48));
			const bw = cell * (2 + Math.floor(Math.random() * 6));
			const bh = cell * (1 + Math.floor(Math.random() * 3));
			const sx = snap(Math.random() * (w - bw), cell);
			const sy = snap(Math.random() * (h - bh), cell);
			const dx = sx + cell * Math.round((Math.random() - 0.5) * 6);
			const dy = sy + cell * Math.round((Math.random() - 0.5) * 2);
			ctx.drawImage(buf, sx, sy, bw, bh, dx, dy, bw, bh);
		}
	}

	// A one-pixel column dragged out sideways, the way a held datamosh frame smears.
	function smear(
		x: number,
		y: number,
		bandH: number,
		alpha: number,
		right: boolean,
	) {
		ctx.globalAlpha = alpha;
		ctx.clearRect(right ? x : 0, y, right ? w - x : x, bandH);
		ctx.drawImage(
			buf,
			x,
			y,
			1,
			bandH,
			right ? x : 0,
			y,
			right ? w - x : x,
			bandH,
		);
		ctx.globalAlpha = 1;
	}

	function snap(v: number, step: number) {
		return Math.round(v / step) * step;
	}

	function tick(now: number) {
		raf = requestAnimationFrame(tick);
		if (!ready || now - last < FRAME_MS) return;
		last = now;

		if (now > nextTwitch) {
			heat = Math.max(heat, 0.3 + Math.random() * 0.4);
			nextTwitch = now + 900 + Math.random() * 2600;
		}
		draw();
		heat *= 0.86;
	}

	const resize = new ResizeObserver(layout);
	resize.observe(canvas);

	document.fonts
		.load(`900 100px ${FONT}`)
		.catch(() => {})
		.then(() => {
			layout();
			ready = true;
		});
	raf = requestAnimationFrame(tick);

	return {
		mosh() {
			rollScars();
			heat = 1;
		},
		disturb(amount) {
			heat = Math.min(1, heat + amount);
		},
		destroy() {
			cancelAnimationFrame(raf);
			resize.disconnect();
		},
	};
}
