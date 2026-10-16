import { describe, expect, it } from "bun:test";
import { decoderOptions } from "./decoder-options";

describe("decoderOptions", () => {
	it("sends an odd-sized track to the software decoder", () => {
		const software = { hardwareAcceleration: "prefer-software" } as const;
		expect(decoderOptions({ codedWidth: 498, codedHeight: 485 })).toEqual(
			software,
		);
		expect(decoderOptions({ codedWidth: 1081, codedHeight: 1920 })).toEqual(
			software,
		);
	});

	it("leaves an even-sized track on the default decoder", () => {
		expect(decoderOptions({ codedWidth: 1920, codedHeight: 1080 })).toEqual({});
	});
});
