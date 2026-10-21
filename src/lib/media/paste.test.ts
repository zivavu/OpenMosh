import { describe, expect, test } from "bun:test";
import { filesFromClipboard } from "./paste";

const file = (name: string, type: string) => new File(["x"], name, { type });

describe("filesFromClipboard", () => {
	test("names a screenshot after when it was pasted", () => {
		const [f] = filesFromClipboard(
			{ files: [file("image.png", "image/png")] },
			123,
		);
		expect(f.name).toBe("pasted-123.png");
		expect(f.type).toBe("image/png");
	});

	test("takes the extension from the type", () => {
		const [f] = filesFromClipboard({ files: [file("", "image/svg+xml")] }, 1);
		expect(f.name).toBe("pasted-1.svg");
	});

	test("keeps a copied file's own name", () => {
		const original = file("holiday.jpg", "image/jpeg");
		expect(filesFromClipboard({ files: [original] })[0]).toBe(original);
	});

	test("a paste with no clipboard data carries nothing", () => {
		expect(filesFromClipboard(null)).toEqual([]);
	});
});
