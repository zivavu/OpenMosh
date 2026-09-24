import { describe, expect, test } from "bun:test";
import { buildLabel, buildLink, REPO_URL } from "./build-info";

const SHA = "a1b2c3d4e5f60718293a4b5c6d7e8f9012345678";

describe("version tag", () => {
	test("a release shows its version and links to its release notes", () => {
		expect(buildLabel("0.9.3", "release", SHA)).toBe("v0.9.3");
		expect(buildLink("0.9.3", "release", SHA)).toBe(
			`${REPO_URL}/releases/tag/v0.9.3`,
		);
	});

	test("a preview names its commit and links to it", () => {
		expect(buildLabel("0.9.3", "preview", SHA)).toBe("v0.9.3 preview a1b2c3d");
		expect(buildLink("0.9.3", "preview", SHA)).toBe(
			`${REPO_URL}/commit/${SHA}`,
		);
	});

	test("a preview without a commit falls back to the release notes", () => {
		expect(buildLabel("0.9.3", "preview", null)).toBe("v0.9.3 preview");
		expect(buildLink("0.9.3", "preview", null)).toBe(
			`${REPO_URL}/releases/tag/v0.9.3`,
		);
	});

	test("a local build says so", () => {
		expect(buildLabel("0.9.3", "local", null)).toBe("v0.9.3 dev");
	});
});
