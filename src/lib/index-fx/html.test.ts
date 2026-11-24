import { expect, test } from "bun:test";
import { CATALOG } from "../effects/catalog";
import { buildPack } from "./pack";
import { INDEX_FX } from "./shortlist";

const files = buildPack({
	catalog: CATALOG,
	license:
		"MIT License\n\nCopyright (c) 2026 OpenMosh\n\nPermission is hereby granted, ...",
	sourceUrl: (id) => `https://example.com/${id}.ts`,
});
const html = files.filter((f) => f.name.endsWith(".html"));

test("one file per effect, plus the README and LICENSE", () => {
	expect(html.length).toBe(Object.keys(INDEX_FX).length);
	expect(files.map((f) => f.name)).toContain("README.md");
	expect(files.map((f) => f.name)).toContain("LICENSE.md");
});

test("each file's manifest survives being read back from its own script", () => {
	for (const f of html) {
		const scripts = [...f.contents.matchAll(/<script>([\s\S]*?)<\/script>/g)];
		expect(scripts.length).toBe(2);
		const tool = new Function(
			`const window = {}; ${scripts[0][1]}; return window.INDEX_TOOL;`,
		)();
		expect(tool.role).toBe("effect");
		expect(tool.effect.passes.length).toBeGreaterThan(0);
	}
});

test("files ported from elsewhere carry that license too", () => {
	const strobe = html.find((f) => f.name.startsWith("RGB_Strobe"))!;
	expect(strobe.contents).toContain("Vidvox ISF-Files");
	expect(strobe.contents.indexOf("Vidvox")).toBeLessThan(
		strobe.contents.indexOf("<html"),
	);
});
