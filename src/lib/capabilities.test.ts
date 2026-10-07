import { describe, expect, test } from "bun:test";
import { assess, type Capabilities } from "./capabilities";

const full: Capabilities = {
	webgl2: true,
	floatTargets: true,
	maxTexture: 16384,
	videoEncode: true,
	firefox: false,
};

describe("assess", () => {
	test("a capable browser has nothing to report", () => {
		expect(assess(full)).toEqual({
			blocking: null,
			exportBlocked: null,
			notes: [],
			slowBrowser: null,
		});
	});

	test("no WebGL2 blocks everything and skips the rest", () => {
		const r = assess({ ...full, webgl2: false, videoEncode: false });
		expect(r.blocking).not.toBeNull();
		expect(r.exportBlocked).toBeNull();
		expect(r.notes).toEqual([]);
	});

	test("no encoder only blocks export", () => {
		const r = assess({ ...full, videoEncode: false });
		expect(r.blocking).toBeNull();
		expect(r.exportBlocked).not.toBeNull();
	});

	test("weak GPUs get notes, not blocks", () => {
		const r = assess({ ...full, floatTargets: false, maxTexture: 2048 });
		expect(r.blocking).toBeNull();
		expect(r.exportBlocked).toBeNull();
		expect(r.notes).toHaveLength(2);
		expect(r.notes[1]).toContain("2048px");
	});

	test("Firefox gets a speed note of its own", () => {
		const r = assess({ ...full, firefox: true });
		expect(r.blocking).toBeNull();
		expect(r.notes).toEqual([]);
		expect(r.slowBrowser).toContain("Firefox");
	});
});
