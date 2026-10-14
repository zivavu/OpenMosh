import { expect, test } from "@playwright/test";
import { openEditor, waitForRender } from "./app";
import { RED } from "./fixtures";

/**
 * The production build, served as it ships, where every other spec runs on the dev
 * server. What only a build has: hashed chunks loaded lazily, the service worker's
 * file list, and the static pages Vercel serves beside the app.
 */

test.beforeEach(async ({ page }) => {
	page.on("pageerror", (error) => {
		throw new Error(`uncaught page error: ${error.message}`);
	});
});

test("the built app opens the editor, whose code loads on demand", async ({
	page,
}) => {
	await openEditor(page, { sources: [["red.png", RED]] });
	await waitForRender(page);
});

test("the service worker lists only files the build serves", async ({
	request,
}) => {
	const sw = await (await request.get("/sw.js")).text();
	const precache = JSON.parse(
		/const PRECACHE = (\[.*?\]);/.exec(sw)![1],
	) as string[];
	expect(precache).toContain("/index.html");
	expect(precache.some((f) => f.startsWith("/assets/"))).toBe(true);
	expect(sw).toMatch(/const VERSION = "[0-9a-f]{12}";/);
	// One missing file fails the worker's whole install.
	for (const file of precache) {
		expect((await request.get(file)).status(), file).toBe(200);
	}
});

test("the about page and the not-found page are plain HTML", async ({
	request,
}) => {
	const about = await (await request.get("/about/")).text();
	expect(about).toContain("<title>About OpenMosh");
	const missing = await (
		await request.get("/no-such-page", { headers: { accept: "text/html" } })
	).text();
	expect(missing).toContain("<title>Page not found");
});
