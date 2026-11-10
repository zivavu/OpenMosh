import { describe, expect, test } from "bun:test";
import {
	type ExportQuality,
	isExportQuality,
	targetVideoBitrate,
} from "./export-quality";

const ORDER: ExportQuality[] = ["small", "standard", "high", "max"];

describe("targetVideoBitrate", () => {
	test("standard keeps the rate exports had before there was a choice", () => {
		expect(targetVideoBitrate("standard", 1920, 1080, 30)).toBe(12_441_600);
		expect(targetVideoBitrate("standard", 320, 240, 24)).toBe(3_000_000);
		expect(targetVideoBitrate("standard", 3840, 2160, 60)).toBe(60_000_000);
	});

	test("each level asks for more than the one below it", () => {
		for (const [w, h, fps] of [
			[320, 240, 24],
			[1280, 720, 30],
			[1920, 1080, 30],
			[3840, 2160, 60],
		] as const) {
			const rates = ORDER.map((q) => targetVideoBitrate(q, w, h, fps));
			for (let i = 1; i < rates.length; i++) {
				expect(rates[i]!).toBeGreaterThan(rates[i - 1]!);
			}
		}
	});
});

test("isExportQuality accepts the levels and nothing else", () => {
	for (const q of ORDER) expect(isExportQuality(q)).toBe(true);
	for (const v of ["", "best", "toString", null, 3]) {
		expect(isExportQuality(v)).toBe(false);
	}
});
