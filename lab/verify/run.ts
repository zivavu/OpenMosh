// `bun lab/verify/run.ts [filter] [--big] [--motion] [--cut] [--strip] [--set=k:v,…] [--app=<effectId>] [--before=<ids>] [--still]`: serves the repo on a spare port, runs the
// verify page in headless Chromium, prints one line per shader and writes
// contact sheets to /tmp/lab-verify. Exits non-zero if any shader fails.
import { mkdirSync, writeFileSync } from "node:fs";
import { chromium } from "@playwright/test";
import { createServer } from "vite";
import type { VerifyResult } from "./verify";

const filter = process.argv.slice(2).find((a) => !a.startsWith("--")) ?? "";
const flags = ["big", "motion", "cut", "strip", "still"]
	.filter((f) => process.argv.includes(`--${f}`))
	.map((f) => `&${f}`)
	.join("");
const set = process.argv.find((a) => a.startsWith("--set="))?.slice(6);
const before = process.argv.find((a) => a.startsWith("--before="))?.slice(9);
const port = Number(process.env.E2E_PORT ?? 5183);
const server = await createServer({
	server: { port, strictPort: true, host: "127.0.0.1" },
	logLevel: "error",
});
await server.listen();
const browser = await chromium.launch({
	args: ["--use-angle=swiftshader", "--enable-unsafe-swiftshader"],
});
try {
	const page = await browser.newPage();
	page.on("pageerror", (e) => console.error("page error:", e.message));
	const app = process.argv.find((a) => a.startsWith("--app="))?.slice(6);
	const page_ = app
		? `app.html?effect=${encodeURIComponent(app)}`
		: `?filter=${encodeURIComponent(filter)}`;
	await page.goto(
		`http://127.0.0.1:${port}/lab/verify/${page_}${flags}${set ? `&set=${encodeURIComponent(set)}` : ""}${before ? `&before=${encodeURIComponent(before)}` : ""}`,
	);
	await page.waitForFunction(() => "__verify" in window, null, {
		timeout: 600_000,
	});
	const { results, sheets } = (await page.evaluate(
		() => (window as unknown as { __verify: unknown }).__verify,
	)) as { results: VerifyResult[]; sheets: string[] };
	const out = "/tmp/lab-verify";
	mkdirSync(out, { recursive: true });
	sheets.forEach((url, i) =>
		writeFileSync(
			`${out}/sheet-${i + 1}.png`,
			Buffer.from(url.split(",")[1], "base64"),
		),
	);
	for (const r of results)
		console.log(
			`${r.ok ? "ok  " : "FAIL"} ${r.name.padEnd(42)} ${r.ms.toFixed(1).padStart(6)}ms  Δ${r.diff.toFixed(1).padStart(5)}  ${r.error?.split("\n").slice(0, 4).join(" | ") ?? r.warnings.join("; ")}`,
		);
	const bad = results.filter((r) => !r.ok).length;
	console.log(
		`${results.length - bad}/${results.length} clean · sheets in ${out}`,
	);
	process.exitCode = bad ? 1 : 0;
} finally {
	await browser.close();
	await server.close();
}
