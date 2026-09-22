import { vitePreprocess } from "@sveltejs/vite-plugin-svelte";

/** @type {import("@sveltejs/vite-plugin-svelte").SvelteConfig} */
export default {
	// Consult https://svelte.dev/docs#compile-time-svelte-preprocess
	// for more information about preprocessors
	preprocess: vitePreprocess(),
	vitePlugin: {
		// Our own components that happen to use no runes would otherwise compile
		// in legacy mode, where a plain `let` is reactive. Forcing runes makes any
		// Svelte 4 syntax a compile error instead of a silent fallback. Set here
		// rather than in `compilerOptions` so it stops at node_modules, where
		// dependencies still ship legacy components.
		dynamicCompileOptions({ filename }) {
			if (!filename.includes("node_modules")) return { runes: true };
		},
	},
};
