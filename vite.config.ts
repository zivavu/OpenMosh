import { svelte } from "@sveltejs/vite-plugin-svelte";
import { createHash } from "node:crypto";
import { readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join, relative } from "node:path";
import { defineConfig, type Plugin } from "vite";

const { version } = JSON.parse(
	readFileSync(new URL("./package.json", import.meta.url), "utf8"),
) as { version: string };

// Vercel tells a build which deployment it is; anything else is a local build.
const vercelEnv = process.env.VERCEL_ENV;
const channel =
	vercelEnv === "production"
		? "release"
		: vercelEnv === "preview"
			? "preview"
			: "local";

// The dev URL, where nothing is hashed yet. This matches the URL Vite rewrites
// the stylesheet's url() to, so the preload is reused.
const DEV_LATIN_FONTS = [
	"/node_modules/@fontsource-variable/archivo/files/archivo-latin-wght-normal.woff2",
];

// The fonts are only referenced from the stylesheet, so the browser doesn't
// start fetching them until it has parsed all of it — long enough on a cold
// cache that the first paint lands inside font-display's block period and the
// whole UI shows up with invisible text (Firefox is the worst about this).
// Preload the latin subsets ahead of the stylesheet link so the preload scanner
// puts them in flight first.
// Only Archivo. The mono is for readouts and rack labels inside the editor —
// nothing on the upload screen resolves to it, so preloading it just spent
// bandwidth ahead of the stylesheet and earned a "preloaded but not used"
// warning. It loads on demand, under the same font-display: swap.
function preloadLatinFonts(): Plugin {
	let base = "/";
	return {
		name: "openmosh:preload-latin-fonts",
		configResolved(config) {
			base = config.base;
		},
		transformIndexHtml: {
			order: "post",
			handler(html, ctx) {
				const hrefs = ctx.bundle
					? Object.keys(ctx.bundle)
							.filter((file) =>
								/archivo-latin-wght-normal-[\w-]+\.woff2$/.test(file),
							)
							.map((file) => base + file)
					: DEV_LATIN_FONTS;
				if (!hrefs.length) return html;

				// Inserted by hand rather than through `injectTo`, which can only
				// append (after the stylesheet) or prepend (ahead of <meta charset>).
				const anchor = /(\n[\t ]*)(?:<link rel="stylesheet"|<\/head>)/;
				return html.replace(anchor, (match: string, indent: string) => {
					const links = hrefs
						.map(
							(href) =>
								`<link rel="preload" as="font" type="font/woff2" crossorigin fetchpriority="high" href="${href}">`,
						)
						.join(indent);
					return `${indent}${links}${match}`;
				});
			},
		},
	};
}

// `/lab` without the slash would fall through to the SPA fallback and land in
// the app; the lab page only resolves at `/lab/`.
function labRedirect(): Plugin {
	return {
		name: "openmosh:lab-redirect",
		configureServer(server) {
			server.middlewares.use((req, res, next) => {
				if (
					req.url === "/lab" ||
					req.url?.startsWith("/lab?") ||
					req.url?.startsWith("/lab#")
				) {
					res.statusCode = 302;
					res.setHeader("Location", "/lab/" + req.url.slice(4));
					res.end();
					return;
				}
				next();
			});
		},
	};
}

/** Public files the offline copy leaves out: only link previews fetch the share image. */
const OFFLINE_SKIP = new Set(["og.jpg"]);

function listFiles(dir: string): string[] {
	return readdirSync(dir, { withFileTypes: true }).flatMap((entry) =>
		entry.isDirectory()
			? listFiles(join(dir, entry.name))
			: [join(dir, entry.name)],
	);
}

// Writes sw.js into the build with the list of files to keep offline.
function serviceWorker(): Plugin {
	let outDir = "dist";
	let publicDir = "public";
	return {
		name: "openmosh:service-worker",
		apply: "build",
		configResolved(config) {
			outDir = config.build.outDir;
			publicDir = config.publicDir;
		},
		writeBundle(_, bundle) {
			const built = Object.keys(bundle).filter((f) => !f.endsWith(".map"));
			const copied = listFiles(publicDir)
				.map((f) => relative(publicDir, f).replaceAll("\\", "/"))
				.filter((f) => !OFFLINE_SKIP.has(f));
			const files = [...new Set([...built, ...copied])].sort();
			const version = createHash("sha256")
				.update(files.join("\n"))
				.digest("hex")
				.slice(0, 12);
			const precache = files.map((f) => "/" + f);
			const source = readFileSync(
				new URL("./sw/service-worker.js", import.meta.url),
				"utf8",
			);
			writeFileSync(
				join(outDir, "sw.js"),
				`const PRECACHE = ${JSON.stringify(precache)};\nconst VERSION = "${version}";\n${source}`,
			);
		},
	};
}

// https://vite.dev/config/
export default defineConfig({
	plugins: [svelte(), preloadLatinFonts(), labRedirect(), serviceWorker()],
	define: {
		__APP_VERSION__: JSON.stringify(version),
		__APP_CHANNEL__: JSON.stringify(channel),
		__APP_COMMIT__: JSON.stringify(process.env.VERCEL_GIT_COMMIT_SHA ?? null),
	},
});
