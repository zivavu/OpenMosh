import { describe, expect, test } from "bun:test";
import { mediaTypeForName, withMediaType } from "./file-type";
import { stableSourceId } from "../editor/sequence-media-store";

describe("withMediaType", () => {
	test("types an untyped file from its extension", () => {
		const file = new File(["x"], "Clip.MOV", { type: "", lastModified: 5 });
		const typed = withMediaType(file);
		expect(typed.type).toBe("video/quicktime");
		expect(typed.name).toBe("Clip.MOV");
		expect(typed.lastModified).toBe(5);
	});

	test("keeps the source id", () => {
		const file = new File(["abc"], "photo.heic", { lastModified: 9 });
		expect(stableSourceId(withMediaType(file))).toBe(stableSourceId(file));
	});

	test("leaves a typed or unknown file alone", () => {
		const typed = new File(["x"], "a.mov", { type: "video/mp4" });
		expect(withMediaType(typed)).toBe(typed);
		const unknown = new File(["x"], "notes.txt");
		expect(withMediaType(unknown)).toBe(unknown);
	});

	test("reads audio and dotless names", () => {
		expect(mediaTypeForName("song.flac")).toBe("audio/flac");
		expect(mediaTypeForName("voice.m4a")).toBe("audio/mp4");
		expect(mediaTypeForName("README")).toBe("");
	});
});
