/** Writes the OpenMosh FX pack for INDEX HTML into a folder:
 *   bun run export:index-fx [out]   (default ../index-html/openmosh-fx)
 * The folder is the exporter's own: its old .html files are removed first. */
import { execFileSync } from "node:child_process";
import {
	mkdirSync,
	readFileSync,
	readdirSync,
	rmSync,
	writeFileSync,
} from "node:fs";
import { join, resolve } from "node:path";
import { CATALOG } from "../src/lib/effects/catalog";
import { buildPack, OPENMOSH_URL } from "../src/lib/index-fx/pack";

const root = resolve(import.meta.dir, "..");
const out = resolve(process.argv[2] ?? join(root, "../index-html/openmosh-fx"));
const catalogDir = join(root, "src/lib/effects/catalog");

const git = (...args: string[]) =>
	execFileSync("git", args, { cwd: root, encoding: "utf8" }).trim();

// Link sources at the last commit that touched them, which has to be on GitHub.
const commit = git(
	"log",
	"-1",
	"--format=%H",
	"--",
	"src/lib/effects",
	"src/lib/gl",
);
try {
	git("merge-base", "--is-ancestor", commit, "origin/main");
} catch {
	console.warn(
		`warning: ${commit.slice(0, 7)} isn't on origin/main; source links won't resolve`,
	);
}

const fileOf = new Map<string, string>();
for (const f of readdirSync(catalogDir)) {
	if (!f.endsWith(".ts") || f.endsWith(".test.ts")) continue;
	const id = readFileSync(join(catalogDir, f), "utf8").match(
		/\bid: "([^"]+)"/,
	)?.[1];
	if (id) fileOf.set(id, f);
}

const files = buildPack({
	catalog: CATALOG,
	license: readFileSync(join(root, "LICENSE"), "utf8"),
	sourceUrl: (id) => {
		const f = fileOf.get(id);
		if (!f) throw new Error(`no catalog file for "${id}"`);
		return `${OPENMOSH_URL}/blob/${commit}/src/lib/effects/catalog/${f}`;
	},
});

mkdirSync(out, { recursive: true });
for (const f of readdirSync(out)) if (f.endsWith(".html")) rmSync(join(out, f));
for (const f of files) writeFileSync(join(out, f.name), f.contents);
console.log(`${files.length} files in ${out}`);
