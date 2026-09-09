import { expect, test } from "@playwright/test";

/**
 * What the rest of the suite is allowed to assume about the browser it runs in.
 *
 * These aren't tests of OpenMosh. They're the reason a failure elsewhere can be
 * read as "the app broke" instead of "the CI container has no GPU": if the
 * export spec goes red and this file is green, the encoder is fine and the app
 * isn't.
 */
test.describe("the browser the suite runs in", () => {
	test("gives a canvas a working WebGL2 context", async ({ page }) => {
		await page.goto("/");
		const gl = await page.evaluate(() => {
			const canvas = document.createElement("canvas");
			const ctx = canvas.getContext("webgl2");
			if (!ctx) return null;
			return {
				renderer: ctx.getParameter(ctx.RENDERER) as string,
				maxTextureSize: ctx.getParameter(ctx.MAX_TEXTURE_SIZE) as number,
				// The editor renders its chain through float textures.
				floatColorBuffer: !!ctx.getExtension("EXT_color_buffer_float"),
			};
		});
		expect(gl).not.toBeNull();
		// 4096 is the floor every preview size decision assumes.
		expect(gl!.maxTextureSize).toBeGreaterThanOrEqual(4096);
		expect(gl!.floatColorBuffer).toBe(true);
	});

	test("actually rasterizes, rather than handing back a blank buffer", async ({
		page,
	}) => {
		await page.goto("/");
		const pixel = await page.evaluate(() => {
			const canvas = document.createElement("canvas");
			canvas.width = 4;
			canvas.height = 4;
			const gl = canvas.getContext("webgl2")!;
			gl.clearColor(0, 1, 0, 1);
			gl.clear(gl.COLOR_BUFFER_BIT);
			const buf = new Uint8Array(4);
			gl.readPixels(0, 0, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, buf);
			return [...buf];
		});
		expect(pixel).toEqual([0, 255, 0, 255]);
	});

	test("can encode the codec the exporter muxes into WebM", async ({
		page,
	}) => {
		await page.goto("/");
		const support = await page.evaluate(async () => {
			if (!("VideoEncoder" in window)) return null;
			const results: Record<string, boolean> = {};
			for (const codec of ["vp8", "vp09.00.10.08"]) {
				const { supported } = await VideoEncoder.isConfigSupported({
					codec,
					width: 320,
					height: 240,
					bitrate: 1_000_000,
				});
				results[codec] = !!supported;
			}
			return results;
		});
		expect(support).not.toBeNull();
		// One of the two is enough — the exporter picks what the machine offers.
		expect(Object.values(support!).some(Boolean)).toBe(true);
	});

	test("can decode video frames off a file", async ({ page }) => {
		await page.goto("/");
		const has = await page.evaluate(
			() => "VideoDecoder" in window && "VideoFrame" in window,
		);
		expect(has).toBe(true);
	});

	test("runs an AudioContext without waiting for a click", async ({ page }) => {
		// The autoplay flag in the config is what makes this true; if it ever
		// stops working, every clock-driven spec hangs instead of failing.
		await page.goto("/");
		const state = await page.evaluate(async () => {
			const ctx = new AudioContext();
			await new Promise((r) => setTimeout(r, 100));
			return ctx.state;
		});
		expect(state).toBe("running");
	});

	test("has the storage the editor persists into", async ({ page }) => {
		await page.goto("/");
		const ok = await page.evaluate(
			() => "indexedDB" in window && "localStorage" in window,
		);
		expect(ok).toBe(true);
	});
});
