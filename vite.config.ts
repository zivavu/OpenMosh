import { svelte } from "@sveltejs/vite-plugin-svelte";
import { defineConfig, type Plugin } from "vite";

// The fonts are only referenced from the stylesheet, so the browser doesn't
// start fetching them until it has parsed all of it — long enough on a cold
// cache that the first paint lands inside font-display's block period and the
// whole UI shows up with invisible text. Preload the latin subsets (the ones
// every screen actually needs) so they're in flight with the CSS itself.
function preloadLatinFonts(): Plugin {
	let base = "/";
	return {
		name: "openmosh:preload-latin-fonts",
		configResolved(config) {
			base = config.base;
		},
		transformIndexHtml: {
			order: "post",
			handler(_html, ctx) {
				const files = Object.keys(ctx.bundle ?? {}).filter((file) =>
					/-latin-wght-normal-[\w-]+\.woff2$/.test(file),
				);
				return files.map((file) => ({
					tag: "link",
					attrs: {
						rel: "preload",
						as: "font",
						type: "font/woff2",
						crossorigin: "",
						href: base + file,
					},
					// Appended rather than prepended so <meta charset> stays first.
					injectTo: "head" as const,
				}));
			},
		},
	};
}

// https://vite.dev/config/
export default defineConfig({
	plugins: [svelte(), preloadLatinFonts()],
});
