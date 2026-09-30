import { describe, expect, test } from "bun:test";
import { createFpsProbe, type DemoVerdict } from "./demo-quality";

function run(fps: number, seconds: number): DemoVerdict | null {
	const probe = createFpsProbe();
	for (let t = 0; t < seconds; t += 1 / fps) {
		const verdict = probe.frame(1 / fps);
		if (verdict) return verdict;
	}
	return null;
}

describe("createFpsProbe", () => {
	test("passes a device at 60fps", () => {
		expect(run(60, 5)).toBe("smooth");
	});

	test("fails a device stuck at 30fps", () => {
		expect(run(30, 5)).toBe("slow");
	});

	test("holds its verdict until warmup and sample have run", () => {
		expect(run(60, 2)).toBeNull();
	});

	test("ignores paused frames and hitches", () => {
		const probe = createFpsProbe();
		for (let i = 0; i < 200; i++) {
			expect(probe.frame(i % 20 === 0 ? 0.5 : 0)).toBeNull();
		}
		let verdict: DemoVerdict | null = null;
		for (let i = 0; i < 400 && !verdict; i++) {
			verdict = probe.frame(i % 30 === 0 ? 1 : 1 / 60);
		}
		expect(verdict).toBe("smooth");
	});
});
