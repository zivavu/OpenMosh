import { expect, test, type Page } from "@playwright/test";

/** Compiles and links every world of one set in the page's WebGL2, the way
 * `ScenePass` builds them. Returns the build log of each world that failed. */
async function buildWorlds(page: Page, set: "WORLDS" | "FLAT_WORLDS") {
	await page.goto("/");
	return page.evaluate(async (set) => {
		// Held in variables so tsc leaves the dev server's module paths alone.
		const worldsUrl = "/src/lib/demo/demo-worlds.ts";
		const sceneUrl = "/src/lib/gl/scene-pass.ts";
		const shadersUrl = "/src/lib/gl/effect-shaders.ts";
		const worlds = (await import(/* @vite-ignore */ worldsUrl))[set] as {
			scene: { id: string };
		}[];
		const { sceneFragment } = await import(/* @vite-ignore */ sceneUrl);
		const { VERTEX_SHADER } = await import(/* @vite-ignore */ shadersUrl);

		const gl = document.createElement("canvas").getContext("webgl2")!;
		const failures: { id: string; log: string }[] = [];
		for (const { scene } of worlds) {
			const program = gl.createProgram();
			const shaders = [
				[gl.VERTEX_SHADER, VERTEX_SHADER],
				[gl.FRAGMENT_SHADER, sceneFragment(scene)],
			].map(([type, source]) => {
				const shader = gl.createShader(type)!;
				gl.shaderSource(shader, source);
				gl.compileShader(shader);
				gl.attachShader(program, shader);
				return shader;
			});
			gl.linkProgram(program);
			if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
				const logs = shaders.map((s) => gl.getShaderInfoLog(s) ?? "");
				failures.push({
					id: scene.id,
					log: [...logs, gl.getProgramInfoLog(program) ?? ""]
						.filter(Boolean)
						.join("\n"),
				});
			}
			for (const s of shaders) gl.deleteShader(s);
			gl.deleteProgram(program);
		}
		return { count: worlds.length, failures };
	}, set);
}

test("every 3D demo world compiles", async ({ page }) => {
	const { count, failures } = await buildWorlds(page, "WORLDS");
	expect(count).toBeGreaterThan(0);
	expect(failures).toEqual([]);
});

test("every flat demo world compiles", async ({ page }) => {
	const { count, failures } = await buildWorlds(page, "FLAT_WORLDS");
	expect(count).toBeGreaterThan(0);
	expect(failures).toEqual([]);
});
