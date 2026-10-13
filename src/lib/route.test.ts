import { describe, expect, test } from "bun:test";
import { parseRoute, routeHash } from "./route";

describe("parseRoute", () => {
	test("reads each view", () => {
		expect(parseRoute("").view).toBe("upload");
		expect(parseRoute("#").view).toBe("upload");
		expect(parseRoute("#single").view).toBe("single");
		expect(parseRoute("#slideshow").view).toBe("slideshow");
		expect(parseRoute("#editor").view).toBe("sequence");
		expect(parseRoute("#sequence").view).toBe("sequence");
		expect(parseRoute("#nowhere").view).toBe("upload");
	});

	test("reads the editor's project", () => {
		expect(parseRoute("#editor/abc")).toEqual({
			view: "sequence",
			key: "proj-abc",
		});
		expect(parseRoute("#sequence/abc").key).toBe("proj-abc");
		expect(parseRoute("#editor").key).toBeNull();
		expect(parseRoute("#editor/").key).toBeNull();
		expect(parseRoute("#editor/%E0%A4%A").key).toBeNull();
	});

	test("reads a single or slideshow edit's own key", () => {
		expect(parseRoute("#single/abc")).toEqual({
			view: "single",
			key: "single:p:abc",
		});
		expect(parseRoute("#slideshow/abc").key).toBe("slideshow:p:abc");
	});

	test("ignores a key on the upload screen", () => {
		expect(parseRoute("#nowhere/abc")).toEqual({ view: "upload", key: null });
	});
});

describe("routeHash", () => {
	test("round-trips each editor's key", () => {
		const cases = [
			["sequence", "proj-abc123"],
			["sequence", "proj-a/b c#d"],
			["single", "single:p:abc"],
			["slideshow", "slideshow:p:abc"],
		] as const;
		for (const [view, key] of cases) {
			expect(parseRoute(routeHash(view, key))).toEqual({ view, key });
		}
	});

	test("links an edit by its id alone", () => {
		expect(routeHash("sequence", "proj-abc")).toBe("#editor/abc");
		expect(routeHash("single", "single:p:abc")).toBe("#single/abc");
	});

	test("leaves off keys that aren't the view's own", () => {
		expect(routeHash("sequence")).toBe("#editor");
		// A project from before projects had ids, keyed by its song.
		expect(routeHash("sequence", "3f2a-song-id")).toBe("#editor");
		expect(routeHash("single", "single:file:a.mp4:1:2")).toBe("#single");
		expect(routeHash("single", "slideshow:p:abc")).toBe("#single");
		expect(routeHash("upload", "proj-abc")).toBe("#");
	});
});
