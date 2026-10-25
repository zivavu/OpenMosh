import { describe, expect, test } from "bun:test";
import {
	filmstripFrameCount,
	filmstripFrameTime,
	filmstripIndexAt,
} from "./filmstrip";

describe("filmstrip", () => {
	test("takes two frames a second, up to a cap", () => {
		expect(filmstripFrameCount(0)).toBe(0);
		expect(filmstripFrameCount(0.2)).toBe(1);
		expect(filmstripFrameCount(3)).toBe(6);
		expect(filmstripFrameCount(3600)).toBe(60);
	});

	test("a frame's own time maps back to it", () => {
		const count = filmstripFrameCount(7);
		for (let i = 0; i < count; i++) {
			expect(filmstripIndexAt(filmstripFrameTime(i, count, 7), count, 7)).toBe(
				i,
			);
		}
	});

	test("wraps past the end the way the picture loops", () => {
		expect(filmstripIndexAt(10.1, 10, 10)).toBe(0);
		expect(filmstripIndexAt(-0.5, 10, 10)).toBe(9);
		expect(filmstripIndexAt(10, 10, 10)).toBe(0);
	});
});
