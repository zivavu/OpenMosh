import { defineConfig, devices } from "@playwright/test";

const PORT = 5173;
/** Where the production build is served for the spec that checks it. */
const PREVIEW_PORT = 4174;
/** The production-build spec; it runs alone, against `vite preview`. */
const PREVIEW_SMOKE = /preview\.spec\.ts/;

/** Projects named on the command line; none means all of them. */
function askedProjects(): string[] {
	const asked: string[] = [];
	process.argv.forEach((arg, i) => {
		if (arg.startsWith("--project=")) asked.push(arg.slice(10));
		else if (arg === "--project" && process.argv[i + 1]) {
			asked.push(process.argv[i + 1]);
		}
	});
	return asked;
}
/** Building takes a while; a run that can't reach the preview project skips it. */
const wantsPreview =
	askedProjects().length === 0 || askedProjects().includes("preview");
/** The only spec Firefox runs; Chromium skips it and runs everything else. Local
 * only: CI's runners have no GL driver Firefox can use. */
const ENGINE_SMOKE = /engines\.spec\.ts/;

const CHROMIUM_ARGS = [
	"--use-gl=angle",
	"--use-angle=swiftshader",
	// Chromium refuses software WebGL without this once it decides the
	// machine has no usable GPU, which is exactly the CI case.
	"--enable-unsafe-swiftshader",
	// The app starts audio and video off its own timers, not off a
	// click, so the autoplay gate has to be open or every clock stalls.
	"--autoplay-policy=no-user-gesture-required",
	"--mute-audio",
];

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
		// The upload screen's demo would eat the CPU the specs render on.
		storageState: {
			cookies: [],
			origins: [
				{
					origin: `http://localhost:${PORT}`,
					localStorage: [
						{
							name: "openmosh-settings",
							value: JSON.stringify({ demoBackground: false }),
						},
					],
				},
			],
		},
		trace: "on-first-retry",
		video: "off",
	},
	projects: [
		{
			name: "chromium",
			testIgnore: [ENGINE_SMOKE, PREVIEW_SMOKE],
			use: {
				...devices["Desktop Chrome"],
				launchOptions: { args: CHROMIUM_ARGS },
			},
		},
		{
			name: "preview",
			testMatch: PREVIEW_SMOKE,
			use: {
				...devices["Desktop Chrome"],
				baseURL: `http://localhost:${PREVIEW_PORT}`,
				storageState: {
					cookies: [],
					origins: [
						{
							origin: `http://localhost:${PREVIEW_PORT}`,
							localStorage: [
								{
									name: "openmosh-settings",
									value: JSON.stringify({ demoBackground: false }),
								},
							],
						},
					],
				},
				launchOptions: { args: CHROMIUM_ARGS },
			},
		},
		...(process.env.CI
			? []
			: [
					{
						name: "firefox",
						testMatch: ENGINE_SMOKE,
						use: {
							...devices["Desktop Firefox"],
							launchOptions: {
								firefoxUserPrefs: {
									"media.autoplay.default": 0,
									"media.volume_scale": "0.0",
								},
							},
						},
					},
				]),
	],
	webServer: [
		{
			command: `bun run dev --port ${PORT} --strictPort`,
			url: `http://localhost:${PORT}`,
			reuseExistingServer: !process.env.CI,
			timeout: 120_000,
		},
		...(wantsPreview
			? [
					{
						// Its own output folder, so a run never clobbers a `bun preview` of dist.
						command: `bunx vite build --outDir dist-e2e --emptyOutDir && bunx vite preview --outDir dist-e2e --port ${PREVIEW_PORT} --strictPort`,
						url: `http://localhost:${PREVIEW_PORT}`,
						reuseExistingServer: !process.env.CI,
						timeout: 180_000,
					},
				]
			: []),
	],
});
