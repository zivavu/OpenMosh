import { expect, test } from "@playwright/test";

/** What the rest of the suite is allowed to assume about the browser it runs in. Not a
 * test of OpenMosh: if the export spec goes red and this is green, the app broke. One page
 * load, soft assertions, so a failure still names every missing capability. */
test("the browser the suite runs in has what the app needs", async ({
	page,
}) => {
	await page.goto("/");
	const caps = await page.evaluate(async () => {
		const canvas = document.createElement("canvas");
		canvas.width = 4;
		canvas.height = 4;
		const gl = canvas.getContext("webgl2");
		let pixel: number[] = [];
		if (gl) {
			gl.clearColor(0, 1, 0, 1);
			gl.clear(gl.COLOR_BUFFER_BIT);
			const buf = new Uint8Array(4);
			gl.readPixels(0, 0, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, buf);
			pixel = [...buf];
		}

		const encoders: boolean[] = [];
		if ("VideoEncoder" in window) {
			for (const codec of ["vp8", "vp09.00.10.08"]) {
				const { supported } = await VideoEncoder.isConfigSupported({
					codec,
					width: 320,
					height: 240,
					bitrate: 1_000_000,
				});
				encoders.push(!!supported);
			}
		}

		const audio = new AudioContext();
		await new Promise((r) => setTimeout(r, 100));

		return {
			webgl2: !!gl,
			maxTextureSize: gl ? (gl.getParameter(gl.MAX_TEXTURE_SIZE) as number) : 0,
			// The editor renders its chain through float textures.
			floatColorBuffer: !!gl?.getExtension("EXT_color_buffer_float"),
			pixel,
			encoders,
			decoder: "VideoDecoder" in window && "VideoFrame" in window,
			audioState: audio.state,
		};
	});

	expect.soft(caps.webgl2, "a WebGL2 context").toBe(true);
	// 4096 is the floor every preview size decision assumes.
	expect.soft(caps.maxTextureSize).toBeGreaterThanOrEqual(4096);
	expect.soft(caps.floatColorBuffer, "EXT_color_buffer_float").toBe(true);
	// Actually rasterizes, rather than handing back a blank buffer.
	expect
		.soft(caps.pixel, "a cleared pixel read back")
		.toEqual([0, 255, 0, 255]);
	// One of the two is enough: the exporter picks what the machine offers.
	expect.soft(caps.encoders.some(Boolean), "a VP8 or VP9 encoder").toBe(true);
	expect.soft(caps.decoder, "WebCodecs decode").toBe(true);
	// The autoplay flag in the config makes this true; without it every clock-driven spec hangs.
	expect
		.soft(caps.audioState, "an AudioContext without a click")
		.toBe("running");
});
