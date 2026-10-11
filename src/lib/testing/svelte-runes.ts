/** Test preload: compiles `.svelte.ts` modules the way Vite does, so their runes run
 * under bun. Without it `$state` is undefined and those modules can't be tested. */
import { plugin } from "bun";
import { dirname, join } from "node:path";
import { compileModule } from "svelte/compiler";

// bun resolves bare "svelte" to the server build; runes compile against the client
// runtime, so a module's own `untrack` and the like must come from there too.
const CLIENT_INDEX = join(
	dirname(Bun.resolveSync("svelte/package.json", import.meta.dir)),
	"src/index-client.js",
).replaceAll("\\", "/");

plugin({
	name: "svelte-runes",
	setup(build) {
		const ts = new Bun.Transpiler({ loader: "ts" });
		build.onLoad({ filter: /\.svelte\.ts$/ }, async ({ path }) => {
			const source = ts.transformSync(await Bun.file(path).text());
			const { js } = compileModule(source, {
				filename: path,
				generate: "client",
			});
			return {
				contents: js.code.replace(/from "svelte";/g, `from "${CLIENT_INDEX}";`),
				loader: "js",
			};
		});
	},
});
