import { describe, expect, it } from "bun:test";
import { assembleChunks, encodeWav, placeTake } from "./mic-take";

describe("assembleChunks", () => {
	it("lays chunks by frame and leaves a skipped gap silent", () => {
		const out = assembleChunks([
			{ frame: 106, samples: new Float32Array([3, 4]) },
			{ frame: 100, samples: new Float32Array([1, 2]) },
		]);
		expect(out?.firstFrame).toBe(100);
		expect([...out!.samples]).toEqual([1, 2, 0, 0, 0, 0, 3, 4]);
	});

	it("is null with nothing captured", () => {
		expect(assembleChunks([])).toBeNull();
	});
});

describe("placeTake", () => {
	const RATE = 1000;

	it("drops what the mic caught before the played sound could reach it", () => {
		// Playback of timeline 4s starts at context 2s; 0.1s of round-trip latency.
		const placed = placeTake(1500, 3000, RATE, { time: 4, ctx: 2 }, 0.1);
		expect(placed).toEqual({ start: 4, skip: 600 });
	});

	it("starts later on the timeline when capture began after playback", () => {
		const placed = placeTake(2600, 3000, RATE, { time: 4, ctx: 2 }, 0.1);
		expect(placed.skip).toBe(0);
		expect(placed.start).toBeCloseTo(4.5);
	});

	it("never skips past the end of the take", () => {
		expect(placeTake(0, 100, RATE, { time: 0, ctx: 5 }, 0).skip).toBe(100);
	});
});

describe("encodeWav", () => {
	it("writes a mono 16-bit header and clamps samples", async () => {
		const blob = encodeWav(new Float32Array([0, 1, -1, 2]), 48000);
		const view = new DataView(await blob.arrayBuffer());
		const text = (at: number) =>
			String.fromCharCode(...new Uint8Array(view.buffer.slice(at, at + 4)));
		expect(blob.size).toBe(44 + 8);
		expect(text(0)).toBe("RIFF");
		expect(text(8)).toBe("WAVE");
		expect(view.getUint16(22, true)).toBe(1);
		expect(view.getUint32(24, true)).toBe(48000);
		expect(view.getUint32(40, true)).toBe(8);
		expect(view.getInt16(46, true)).toBe(0x7fff);
		expect(view.getInt16(48, true)).toBe(-0x8000);
		expect(view.getInt16(50, true)).toBe(0x7fff);
	});
});
