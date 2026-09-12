// One-off sanity pass over the lab shaders: parse each ISF header, expand the
// IMG macros and build the final fragment source, reporting any failure.
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { parseIsf, buildFragmentSource } from "./isf.ts";

const roots = readdirSync(join(import.meta.dir, "shaders"), {
	withFileTypes: true,
}).filter((d) => d.isDirectory());
let bad = 0;
let total = 0;
for (const root of roots) {
	const dir = join(import.meta.dir, "shaders", root.name);
	for (const file of readdirSync(dir)) {
		if (!file.endsWith(".fs")) continue;
		total++;
		const src = readFileSync(join(dir, file), "utf8");
		try {
			const { header, body } = parseIsf(src);
			const targets = (header.PASSES ?? [])
				.map((p) => p.TARGET)
				.filter((t): t is string => !!t);
			buildFragmentSource(header, body, targets);
			const opens = (body.match(/\{/g) ?? []).length;
			const closes = (body.match(/\}/g) ?? []).length;
			if (opens !== closes)
				throw new Error(`unbalanced braces (${opens} vs ${closes})`);
		} catch (e) {
			bad++;
			console.log(`FAIL ${root.name}/${file}: ${(e as Error).message}`);
		}
	}
}
console.log(`${total - bad}/${total} shaders parse and build cleanly`);
