import { defineConfig, devices } from "@playwright/test";

const PORT = 5173;

/**
 * End-to-end config for the parts of OpenMosh no unit test can reach: WebGL2
 * rendering, WebCodecs decode/encode, and the IndexedDB round-trip behind
 * resuming an edit.
 *
 * SwiftShader is forced on locally as well as in CI. A dev machine's real GPU
 * and a CI container's software rasterizer disagree about timing and about the
 * last bit of a pixel, and a suite that only passes on one of them is worse
 * than no suite — so both run the same renderer.
 */
export default defineConfig({
	testDir: "./tests/e2e",
	// Media decode under a software rasterizer is slow; the default 30s trips
	// on the export specs for no real reason.
	timeout: 90_000,
	expect: { timeout: 15_000 },
	fullyParallel: true,
	forbidOnly: !!process.env.CI,
	retries: process.env.CI ? 1 : 0,
	// Every worker is another software-rendered WebGL2 context and its own
	// decode threads; more of them makes the whole run slower, not faster.
	workers: process.env.CI ? 1 : 2,
	reporter: process.env.CI
		? [["github"], ["list"], ["html", { open: "never" }]]
		: [["list"]],
	use: {
		baseURL: `http://localhost:${PORT}`,
		trace: "on-first-retry",
		video: "off",
	},
	projects: [
		{
			name: "chromium",
			use: {
				...devices["Desktop Chrome"],
				launchOptions: {
					args: [
						"--use-gl=angle",
						"--use-angle=swiftshader",
						// Chromium refuses software WebGL without this once it decides the
						// machine has no usable GPU, which is exactly the CI case.
						"--enable-unsafe-swiftshader",
						// The app starts audio and video off its own timers, not off a
						// click, so the autoplay gate has to be open or every clock stalls.
						"--autoplay-policy=no-user-gesture-required",
						"--mute-audio",
					],
				},
			},
		},
	],
	webServer: {
		command: `bun run dev --port ${PORT} --strictPort`,
		url: `http://localhost:${PORT}`,
		reuseExistingServer: !process.env.CI,
		timeout: 120_000,
	},
});
