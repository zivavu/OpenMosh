import { describe, expect, test } from "bun:test";
import { DEFAULT_MEDIA_STYLE, type MediaStyle } from "../media/types";
import {
	clampMove,
	KEEP_PX,
	MIN_SCALE,
	rotateFromHandle,
	scaleFromHandle,
	type HandleFrame,
} from "./layer-drag";

const FW = 400;
const FH = 300;

/** A 100×80 box centred at (200, 150): rect (150, 110, 100, 80). */
const FROM: MediaStyle = {
	...DEFAULT_MEDIA_STYLE,
	x: 0.5,
	y: 0.5,
	scale: 1,
	scaleX: 1,
	scaleY: 1,
	rotation: 0,
};

/** The box's centre and half-extents a style lands at, in output pixels. */
function boxOf(style: MediaStyle) {
	return {
		cx: style.x * FW,
		cy: style.y * FH,
		hw: (100 * style.scale * style.scaleX) / 2,
		hh: (80 * style.scale * style.scaleY) / 2,
	};
}

function frame(g: Partial<HandleFrame> = {}): HandleFrame {
	return { hx: 1, hy: 1, cx: 200, cy: 150, rot: 0, c0x: 50, c0y: 40, ...g };
}

describe("scaleFromHandle", () => {
	test("a press on the handle changes nothing", () => {
		expect(scaleFromHandle(FROM, frame(), 250, 190, FW, FH, false)).toEqual(
			FROM,
		);
	});

	test("a dragged corner lands on the cursor and the opposite one stays put", () => {
		for (const t of [0.5, 1.25, 2]) {
			const next = scaleFromHandle(
				FROM,
				frame(),
				200 + 50 * t,
				150 + 40 * t,
				FW,
				FH,
				false,
			);
			const b = boxOf(next);
			expect(b.cx + b.hw).toBeCloseTo(200 + 50 * t);
			expect(b.cy + b.hh).toBeCloseTo(150 + 40 * t);
			expect(b.cx - b.hw).toBeCloseTo(150);
			expect(b.cy - b.hh).toBeCloseTo(110);
		}
	});

	test("a dragged side moves its one edge, keeping the other axis", () => {
		const next = scaleFromHandle(
			FROM,
			frame({ hy: 0, c0y: 0 }),
			275,
			190,
			FW,
			FH,
			false,
		);
		const b = boxOf(next);
		expect(b.cx + b.hw).toBeCloseTo(275);
		expect(b.cx - b.hw).toBeCloseTo(150);
		expect(b.cy - b.hh).toBeCloseTo(110);
		expect(b.cy + b.hh).toBeCloseTo(190);
		expect(next.scaleY).toBe(1);
	});

	test("Alt keeps the centre and puts the corner on the cursor", () => {
		const next = scaleFromHandle(FROM, frame(), 275, 210, FW, FH, true);
		const b = boxOf(next);
		expect(b.cx).toBeCloseTo(200);
		expect(b.cy).toBeCloseTo(150);
		expect(b.cx + b.hw).toBeCloseTo(275);
		expect(b.cy + b.hh).toBeCloseTo(210);
	});

	test("a rotated layer scales along its own edges", () => {
		const rot = Math.PI / 2;
		// The right-side handle sits below the centre once turned; the cursor
		// drags it further down.
		const next = scaleFromHandle(
			FROM,
			frame({ hy: 0, rot, c0x: 50, c0y: 0 }),
			200,
			250,
			FW,
			FH,
			false,
		);
		const b = boxOf(next);
		// The side's midpoint, turned the way the box is.
		const mx = b.hw * Math.cos(rot);
		const my = b.hw * Math.sin(rot);
		expect(b.cx + mx).toBeCloseTo(200);
		expect(b.cy + my).toBeCloseTo(250);
		expect(b.cx - mx).toBeCloseTo(200);
		expect(b.cy - my).toBeCloseTo(100);
		expect(next.scaleY).toBe(1);
	});

	test("a side cannot drag past the slider's floor", () => {
		const from = { ...FROM, scaleX: 0.06 };
		const next = scaleFromHandle(
			from,
			frame({ hy: 0, c0x: 50, c0y: 0 }),
			151,
			150,
			FW,
			FH,
			false,
		);
		expect(next.scaleX).toBe(MIN_SCALE);
	});
});
describe("clampMove", () => {
	// The 100×80 box: half-extents 50×40.
	test("a move inside the frame is unchanged", () => {
		expect(clampMove(FROM, 30, -20, 50, 40, FW, FH)).toEqual({
			x: 230 / FW,
			y: 130 / FH,
		});
	});

	test("a drag off the frame stops with a grabbable strip left on it", () => {
		const { x, y } = clampMove(FROM, -1000, 1000, 50, 40, FW, FH);
		// Right edge of the box sits KEEP_PX in from the left of the frame.
		expect(x * FW + 50).toBeCloseTo(KEEP_PX);
		// Top edge sits KEEP_PX up from the bottom.
		expect(y * FH - 40).toBeCloseTo(FH - KEEP_PX);
	});

	test("a box smaller than the strip stays wholly on the frame", () => {
		const { x, y } = clampMove(FROM, 1000, -1000, 10, 8, FW, FH);
		expect(x * FW + 10).toBeCloseTo(FW);
		expect(y * FH - 8).toBeCloseTo(0);
	});
});

describe("rotateFromHandle", () => {
	// Pressed straight above the centre, as the handle sits on an unrotated box.
	const g = { cx: 200, cy: 150, a0: -Math.PI / 2 };

	test("turns clockwise as the pointer goes round to the right", () => {
		expect(rotateFromHandle(FROM, g, 300, 150, false)).toBeCloseTo(90, 6);
	});

	test("adds to the rotation the layer already had", () => {
		const from = { ...FROM, rotation: 30 };
		expect(rotateFromHandle(from, g, 100, 150, false)).toBeCloseTo(-60, 6);
	});

	test("stays within a half turn either way", () => {
		const from = { ...FROM, rotation: 170 };
		expect(rotateFromHandle(from, g, 300, 150, false)).toBeCloseTo(-100, 6);
	});

	test("snaps with Shift", () => {
		expect(rotateFromHandle(FROM, g, 300, 140, true)).toBe(90);
		expect(rotateFromHandle(FROM, g, 300, 130, true)).toBe(75);
	});
});
