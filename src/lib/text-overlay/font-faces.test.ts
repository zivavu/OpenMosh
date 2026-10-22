import { describe, expect, it } from "bun:test";
import { parseFontFaces, pickFaces, requestedFamily } from "./font-faces";

const face = (family: string, range: string, weight = 400, style = "normal") =>
	`@font-face { font-family: '${family}'; font-style: ${style}; font-weight: ${weight};
  src: url(https://fonts.gstatic.com/${family}-${weight}-${range.length}.woff2) format('woff2');
  unicode-range: ${range}; }`;

const LATIN = "U+0000-00FF, U+0131";
const LATIN_EXT = "U+0100-02BA, U+02BD-02C5";
const CYRILLIC = "U+0301, U+0400-045F";

describe("picking a Google Fonts face", () => {
	it("keeps every script subset of the regular weight, latin first", () => {
		const css = [
			face("Rubik", CYRILLIC),
			face("Rubik", LATIN_EXT),
			face("Rubik", LATIN),
			face("Rubik", LATIN, 700),
			face("Rubik", LATIN, 400, "italic"),
		].join("\n");
		const picked = pickFaces(parseFontFaces(css), "Rubik");
		expect(picked.map((f) => f.unicodeRange)).toEqual([
			LATIN,
			CYRILLIC,
			LATIN_EXT,
		]);
	});

	it("takes the family the link names first, not whichever comes first", () => {
		const css = [face("Roboto", LATIN), face("Open Sans", LATIN)].join("\n");
		const url =
			"https://fonts.googleapis.com/css2?family=Open+Sans:wght@400&family=Roboto";
		const picked = pickFaces(parseFontFaces(css), requestedFamily(url));
		expect(picked.map((f) => f.name)).toEqual(["Open Sans"]);
	});

	it("reads the family from an older link", () => {
		expect(
			requestedFamily("https://fonts.googleapis.com/css?family=Lato|Roboto"),
		).toBe("Lato");
	});
});
