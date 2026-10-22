import { describe, expect, it } from "bun:test";
import { packFontSlices, unpackFontSlices } from "./font-pack";

const bytes = (...values: number[]) => new Uint8Array(values).buffer;

describe("font packs", () => {
	it("round-trips each slice with its range", () => {
		const packed = packFontSlices([
			{ data: bytes(1, 2, 3), unicodeRange: "U+0000-00FF" },
			{ data: bytes(4, 5), unicodeRange: "U+0100-024F" },
		]);
		const slices = unpackFontSlices(packed)!;
		expect(slices.map((s) => [...new Uint8Array(s.data)])).toEqual([
			[1, 2, 3],
			[4, 5],
		]);
		expect(slices.map((s) => s.unicodeRange)).toEqual([
			"U+0000-00FF",
			"U+0100-024F",
		]);
	});

	it("leaves a plain font file alone", () => {
		expect(
			unpackFontSlices(bytes(0x77, 0x4f, 0x46, 0x32, 0, 1, 0, 0)),
		).toBeNull();
		expect(unpackFontSlices(bytes())).toBeNull();
	});

	it("refuses a pack whose index claims more than is there", () => {
		const packed = new Uint8Array(
			packFontSlices([{ data: bytes(1, 2, 3), unicodeRange: "" }]),
		);
		// The index's length, past the end of the file.
		const huge = packed.slice();
		new DataView(huge.buffer).setUint32(8, 0xffffffff);
		expect(unpackFontSlices(huge.buffer)).toBeNull();
		// A slice longer than the bytes after it.
		const cut = packed.slice(0, packed.length - 1);
		expect(unpackFontSlices(cut.buffer)).toBeNull();
		// An index that isn't JSON.
		const garbled = packed.slice();
		garbled[12] = 0x7b;
		garbled[13] = 0x7b;
		expect(unpackFontSlices(garbled.buffer)).toBeNull();
	});
});
