import {
	ctx2d,
	grain,
	makeCanvas,
	MONO,
	pick,
	ramp,
	TAU,
	WORDS,
	type Env,
	type Generator,
} from "../kit";

const BARS75 = [
	"#c0c0c0",
	"#c0c000",
	"#00c0c0",
	"#00c000",
	"#c000c0",
	"#c00000",
	"#0000c0",
];
const BARS100 = [
	"#ffffff",
	"#ffff00",
	"#00ffff",
	"#00ff00",
	"#ff00ff",
	"#ff0000",
	"#0000ff",
	"#000000",
];

function smpte({ ctx, w, h }: Env) {
	const bw = w / 7;
	const top = h * 0.67;
	const mid = h * 0.75;
	BARS75.forEach((c, i) => {
		ctx.fillStyle = c;
		ctx.fillRect(i * bw, 0, bw + 1, top);
	});
	[
		"#0000c0",
		"#131313",
		"#c000c0",
		"#131313",
		"#00c0c0",
		"#131313",
		"#c0c0c0",
	].forEach((c, i) => {
		ctx.fillStyle = c;
		ctx.fillRect(i * bw, top, bw + 1, mid - top);
	});
	const bottom: [string, number][] = [
		["#00214c", 1.25],
		["#ffffff", 1.25],
		["#32006a", 1.25],
		["#131313", 1.25],
		["#090909", 1 / 3],
		["#131313", 1 / 3],
		["#1d1d1d", 1 / 3],
		["#131313", 1],
	];
	let x = 0;
	for (const [c, span] of bottom) {
		ctx.fillStyle = c;
		ctx.fillRect(x, mid, span * bw + 1, h - mid);
		x += span * bw;
	}
}

function pm5544({ ctx, w, h, u }: Env, label: string) {
	ctx.fillStyle = "#7a7a7a";
	ctx.fillRect(0, 0, w, h);
	const g = u / 14;
	const gx = (w % g) / 2;
	const gy = (h % g) / 2;
	ctx.strokeStyle = "#f0f0f0";
	ctx.lineWidth = Math.max(1, u * 0.003);
	ctx.beginPath();
	for (let x = gx; x <= w; x += g) {
		ctx.moveTo(x, 0);
		ctx.lineTo(x, h);
	}
	for (let y = gy; y <= h; y += g) {
		ctx.moveTo(0, y);
		ctx.lineTo(w, y);
	}
	ctx.stroke();
	const cast = g * 0.5;
	for (let x = 0, i = 0; x < w; x += cast, i++) {
		ctx.fillStyle = i % 2 ? "#000" : "#fff";
		ctx.fillRect(x, 0, cast, cast * 0.6);
		ctx.fillRect(x, h - cast * 0.6, cast, cast * 0.6);
	}
	for (let y = 0, i = 0; y < h; y += cast, i++) {
		ctx.fillStyle = i % 2 ? "#000" : "#fff";
		ctx.fillRect(0, y, cast * 0.6, cast);
		ctx.fillRect(w - cast * 0.6, y, cast * 0.6, cast);
	}

	const cx = w / 2;
	const cy = h / 2;
	const R = u * 0.43;
	ctx.save();
	ctx.beginPath();
	ctx.arc(cx, cy, R, 0, TAU);
	ctx.clip();
	ctx.fillStyle = "#7a7a7a";
	ctx.fillRect(cx - R, cy - R, R * 2, R * 2);
	const rows = 10;
	const rh = (R * 2) / rows;
	const y0 = cy - R;
	const left = cx - R;
	const W = R * 2;
	["#c0c000", "#00c0c0", "#00c000", "#c000c0", "#c00000", "#0000c0"].forEach(
		(c, i) => {
			ctx.fillStyle = c;
			ctx.fillRect(left + (i * W) / 6, y0, W / 6 + 1, rh * 2);
		},
	);
	ctx.fillStyle = "#000";
	ctx.fillRect(left, y0 + rh * 2, W, rh);
	ctx.fillStyle = "#fff";
	ctx.fillRect(cx - W * 0.3, y0 + rh * 2, W * 0.6, rh);
	for (let i = 0; i < 6; i++) {
		const v = Math.round((i / 5) * 255);
		ctx.fillStyle = `rgb(${v},${v},${v})`;
		ctx.fillRect(left + (i * W) / 6, y0 + rh * 3, W / 6 + 1, rh * 1.5);
	}
	const fy = y0 + rh * 4.5;
	ctx.fillStyle = "#000";
	ctx.fillRect(left, fy, W, rh * 1.5);
	for (let k = 0; k < 5; k++) {
		const x0 = left + W * 0.1 + (k * W * 0.8) / 5;
		const period = Math.max(2, (u * 0.04) / (k + 1) ** 1.2);
		ctx.fillStyle = "#fff";
		for (let x = x0; x < x0 + (W * 0.8) / 5; x += period)
			ctx.fillRect(x, fy, period / 2, rh * 1.5);
	}
	ctx.fillStyle = "#fff";
	ctx.fillRect(left, y0 + rh * 6, W, rh * 0.5);
	ctx.fillStyle = "#000";
	ctx.fillRect(cx - 1, y0 + rh * 6, 2, rh * 0.5);
	for (let i = 0; i < 12; i++) {
		const t = i / 11;
		ctx.fillStyle = `rgb(${Math.round(255 * (1 - t))},${Math.round(200 * t)},${Math.round(255 * t)})`;
		ctx.fillRect(left + (i * W) / 12, y0 + rh * 6.5, W / 12 + 1, rh * 1.5);
	}
	ctx.fillStyle = "#c0c000";
	ctx.fillRect(left, y0 + rh * 8, W / 2, rh * 2);
	ctx.fillStyle = "#c00000";
	ctx.fillRect(cx, y0 + rh * 8, W / 2, rh * 2);
	ctx.restore();

	ctx.strokeStyle = "#fff";
	ctx.lineWidth = Math.max(1, u * 0.004);
	ctx.beginPath();
	ctx.arc(cx, cy, R, 0, TAU);
	ctx.stroke();
	ctx.beginPath();
	ctx.moveTo(cx - R, cy);
	ctx.lineTo(cx + R, cy);
	ctx.moveTo(cx, cy - R * 0.2);
	ctx.lineTo(cx, cy + R * 0.2);
	ctx.stroke();

	ctx.font = `700 ${rh * 0.7}px ${MONO}`;
	ctx.textAlign = "center";
	ctx.textBaseline = "middle";
	const bw = ctx.measureText(label).width + rh;
	ctx.fillStyle = "#000";
	ctx.fillRect(cx - bw / 2, y0 + rh * 2, bw, rh);
	ctx.fillStyle = "#fff";
	ctx.fillText(label, cx, y0 + rh * 2.5);
}

function monoscope({ ctx, w, h, u, rng }: Env, label: string) {
	ctx.fillStyle = "#1b1b1b";
	ctx.fillRect(0, 0, w, h);
	const cx = w / 2;
	const cy = h / 2;
	ctx.strokeStyle = "#e8e8e8";
	ctx.fillStyle = "#e8e8e8";
	const lw = Math.max(1, u * 0.003);
	ctx.lineWidth = lw;
	for (let r = u * 0.06; r < u * 0.46; r += u * 0.05) {
		ctx.beginPath();
		ctx.arc(cx, cy, r, 0, TAU);
		ctx.stroke();
	}
	ctx.beginPath();
	ctx.moveTo(0, cy);
	ctx.lineTo(w, cy);
	ctx.moveTo(cx, 0);
	ctx.lineTo(cx, h);
	ctx.stroke();
	const wedge = (ang: number) => {
		const lines = 14;
		const len = u * 0.3;
		const near = u * 0.07;
		const spread = u * 0.12;
		for (let i = 0; i < lines; i++) {
			const t = i / (lines - 1) - 0.5;
			const dx = Math.cos(ang);
			const dy = Math.sin(ang);
			const nx = -dy;
			const ny = dx;
			ctx.beginPath();
			ctx.moveTo(
				cx + dx * near + nx * t * spread * 0.15,
				cy + dy * near + ny * t * spread * 0.15,
			);
			ctx.lineTo(
				cx + dx * (near + len) + nx * t * spread,
				cy + dy * (near + len) + ny * t * spread,
			);
			ctx.stroke();
		}
	};
	for (let k = 0; k < 4; k++) wedge((k * Math.PI) / 2 + Math.PI / 4);
	const corners: [number, number][] = [
		[u * 0.12, u * 0.12],
		[w - u * 0.12, u * 0.12],
		[w - u * 0.12, h - u * 0.12],
		[u * 0.12, h - u * 0.12],
	];
	for (const [x, y] of corners) {
		for (let r = u * 0.02; r < u * 0.1; r += u * 0.018) {
			ctx.beginPath();
			ctx.arc(x, y, r, 0, TAU);
			ctx.stroke();
		}
		ctx.beginPath();
		ctx.arc(x, y, u * 0.012, 0, TAU);
		ctx.fill();
	}
	const steps = 8;
	for (let i = 0; i < steps; i++) {
		const v = Math.round((i / (steps - 1)) * 235 + 10);
		ctx.fillStyle = `rgb(${v},${v},${v})`;
		ctx.fillRect(
			cx - u * 0.32 + (i * u * 0.64) / steps,
			cy + u * 0.36,
			(u * 0.64) / steps + 1,
			u * 0.05,
		);
	}
	ctx.fillStyle = "#000";
	const bw = u * 0.34;
	const bh = u * 0.09;
	ctx.fillRect(cx - bw / 2, cy - bh / 2, bw, bh);
	ctx.strokeRect(cx - bw / 2, cy - bh / 2, bw, bh);
	ctx.fillStyle = "#fff";
	ctx.font = `700 ${bh * 0.5}px ${MONO}`;
	ctx.textAlign = "center";
	ctx.textBaseline = "middle";
	ctx.fillText(label, cx, cy);
	if (rng() < 0.5) {
		ctx.fillStyle = "rgba(255,255,255,0.08)";
		ctx.beginPath();
		ctx.arc(cx, cy, u * 0.46, 0, TAU);
		ctx.fill();
	}
}

function ebu({ ctx, w, h, u }: Env) {
	const bw = w / 8;
	BARS100.forEach((c, i) => {
		ctx.fillStyle = c;
		ctx.fillRect(i * bw, 0, bw + 1, h * 0.8);
	});
	const g = ctx.createLinearGradient(0, 0, w, 0);
	g.addColorStop(0, "#000");
	g.addColorStop(1, "#fff");
	ctx.fillStyle = g;
	ctx.fillRect(0, h * 0.8, w, h * 0.1);
	ctx.fillStyle = "#101010";
	ctx.fillRect(0, h * 0.9, w, h * 0.1);
	ctx.fillStyle = "#ddd";
	ctx.font = `700 ${u * 0.04}px ${MONO}`;
	ctx.textBaseline = "middle";
	ctx.textAlign = "left";
	ctx.fillText("1 kHz  -18 dBFS", u * 0.04, h * 0.95);
}

function osd({ ctx, w, h, u, rng }: Env) {
	const size = u * 0.045;
	ctx.font = `700 ${size}px ${MONO}`;
	ctx.textBaseline = "top";
	const shadow = (
		text: string,
		x: number,
		y: number,
		align: CanvasTextAlign,
	) => {
		ctx.textAlign = align;
		ctx.fillStyle = "rgba(0,0,0,0.8)";
		ctx.fillText(text, x + size * 0.08, y + size * 0.08);
		ctx.fillStyle = "#f4f4f4";
		ctx.fillText(text, x, y);
	};
	shadow(
		`CH ${String(1 + Math.floor(rng() * 99)).padStart(2, "0")}`,
		u * 0.06,
		u * 0.05,
		"left",
	);
	const tc = [rng() * 24, rng() * 60, rng() * 60, rng() * 25]
		.map((v) => String(Math.floor(v)).padStart(2, "0"))
		.join(":");
	shadow(tc, w - u * 0.06, h - u * 0.05 - size, "right");
	if (rng() < 0.5)
		shadow(
			pick(rng, ["▶ PLAY", "❚❚ PAUSE", "◀◀ REW", "● REC", "SP"]),
			u * 0.06,
			h - u * 0.05 - size,
			"left",
		);
}

export const testcard: Generator = {
	id: "testcard",
	name: "Test card",
	group: "Signal & broadcast",
	blurb:
		"SMPTE bars, a PM5544-style circle, a monoscope or EBU bars, then knocked out of true: tinted into the palette, torn by sync loss, ghosted and scanlined.",
	params: [
		{
			key: "card",
			label: "Card",
			type: "select",
			options: ["Random", "SMPTE", "PM5544", "Monoscope", "EBU bars"],
			value: "Random",
		},
		{
			key: "tint",
			label: "Palette tint",
			type: "range",
			min: 0,
			max: 1,
			value: 0,
		},
		{
			key: "sync",
			label: "Sync tearing",
			type: "range",
			min: 0,
			max: 1,
			value: 0.25,
		},
		{
			key: "ghost",
			label: "Ghosting",
			type: "range",
			min: 0,
			max: 1,
			value: 0.2,
		},
		{
			key: "scan",
			label: "Scanlines",
			type: "range",
			min: 0,
			max: 1,
			value: 0.3,
		},
		{ key: "osd", label: "On-screen display", type: "bool", value: true },
	],
	render(env, p) {
		const { ctx, w, h, u, rng, inks } = env;
		const card =
			p.card === "Random"
				? pick(rng, ["SMPTE", "PM5544", "Monoscope", "EBU bars"])
				: (p.card as string);
		const label = rng() < 0.5 ? "OPENMOSH" : pick(rng, WORDS);
		if (card === "SMPTE") smpte(env);
		else if (card === "PM5544") pm5544(env, label);
		else if (card === "Monoscope") monoscope(env, label);
		else ebu(env);
		if (p.osd) osd(env);

		const tint = p.tint as number;
		if (tint > 0) {
			const col = ramp(inks);
			const img = ctx.getImageData(0, 0, w, h);
			const d = img.data;
			const lut = Array.from({ length: 256 }, (_, i) => col(i / 255));
			for (let i = 0; i < d.length; i += 4) {
				const l = Math.round(
					0.2126 * d[i] + 0.7152 * d[i + 1] + 0.0722 * d[i + 2],
				);
				const c = lut[l];
				d[i] += (c[0] - d[i]) * tint;
				d[i + 1] += (c[1] - d[i + 1]) * tint;
				d[i + 2] += (c[2] - d[i + 2]) * tint;
			}
			ctx.putImageData(img, 0, 0);
		}

		const snap = makeCanvas(w, h);
		ctx2d(snap).drawImage(ctx.canvas, 0, 0);

		const ghost = p.ghost as number;
		if (ghost > 0) {
			ctx.save();
			ctx.globalCompositeOperation = "screen";
			ctx.globalAlpha = 0.35 * ghost;
			ctx.drawImage(snap, u * 0.035 * ghost, 0);
			ctx.globalAlpha = 0.2 * ghost;
			ctx.drawImage(snap, u * 0.09 * ghost, 0);
			ctx.restore();
			ctx2d(snap).drawImage(ctx.canvas, 0, 0);
		}

		const sync = p.sync as number;
		if (sync > 0) {
			const bands = Math.round(sync * 8);
			for (let i = 0; i < bands; i++) {
				const y = rng() * h;
				const bh = u * (0.005 + rng() * 0.08 * sync);
				const shift = (rng() - 0.5) * w * 0.5 * sync;
				ctx.drawImage(snap, 0, y, w, bh, shift, y, w, bh);
				ctx.drawImage(
					snap,
					0,
					y,
					w,
					bh,
					shift - Math.sign(shift) * w,
					y,
					w,
					bh,
				);
			}
			if (sync > 0.55) {
				const roll = h * (0.15 + rng() * 0.6);
				ctx.drawImage(snap, 0, roll - h, w, h);
				ctx.drawImage(snap, 0, roll, w, h);
				ctx.fillStyle = "#000";
				ctx.fillRect(0, roll - u * 0.02, w, u * 0.04);
				ctx.fillStyle = "rgba(255,255,255,0.12)";
				ctx.fillRect(0, roll + u * 0.02, w, u * 0.004);
			}
		}

		const scan = p.scan as number;
		if (scan > 0) {
			const step = Math.max(2, Math.round(u / 300));
			ctx.fillStyle = `rgba(0,0,0,${0.35 * scan})`;
			for (let y = 0; y < h; y += step * 2) ctx.fillRect(0, y, w, step);
		}
		grain(env, 0.04);
	},
};
