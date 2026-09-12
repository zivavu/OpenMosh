import { svelte } from "@sveltejs/vite-plugin-svelte";
import { defineConfig, type Plugin } from "vite";

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
				if (req.url === "/lab" || req.url?.startsWith("/lab?") || req.url?.startsWith("/lab#")) {
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

// https://vite.dev/config/
export default defineConfig({
	plugins: [svelte(), preloadLatinFonts(), labRedirect()],
});
