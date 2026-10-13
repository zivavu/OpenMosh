import { expect, test, type Page } from "@playwright/test";
import {
	mediaClips,
	openEditor,
	openSingle,
	PREVIEW_CANVAS,
	selectMode,
	splitClipAt,
	waitForRender,
	waitForSaved,
} from "./app";
import { BLUE, GREEN, imageFile, RED, trackFile } from "./fixtures";

/** Each editor's URL names the saved edit it has open, so a reload or a pasted link
 * comes back to that edit rather than to whatever was opened last. */

test.beforeEach(async ({ page }) => {
	page.on("pageerror", (error) => {
		throw new Error(`uncaught page error: ${error.message}`);
	});
});

const GONE = "That project is no longer stored";

async function moshSingle(page: Page) {
	await waitForRender(page);
	await page.getByRole("button", { name: "MOSH", exact: true }).click();
	await waitForSaved(page);
}

test("an editor project's link opens it, and a dead one lands on the upload screen", async ({
	page,
}) => {
	await openEditor(page, {
		sources: [
			["red.png", RED],
			["green.png", GREEN],
		],
	});
	await waitForRender(page);
	await splitClipAt(page, 0.5);
	await waitForSaved(page);
	await expect(page).toHaveURL(/#editor\/[^/]+$/);
	const link = page.url();

	await page.goto("/");
	await page.goto(link);
	await expect(page.locator(PREVIEW_CANVAS)).toBeVisible({ timeout: 30_000 });
	await waitForRender(page);
	await expect(mediaClips(page)).toHaveCount(2);
	await expect(page).toHaveURL(link);
	// A cold load of the link, not a hash change on a running app.
	await page.reload();
	await expect(page.locator(PREVIEW_CANVAS)).toBeVisible({ timeout: 30_000 });
	await expect(mediaClips(page)).toHaveCount(2);

	await page.goto("/");
	await page.goto("/#editor/gone");
	await expect(page.getByText(GONE)).toBeVisible();
	await expect(page).toHaveURL(/#$/);
});

test("a single edit gets a link once it saves, and another's link swaps it in", async ({
	page,
}) => {
	await openSingle(page, "red.png", RED);
	await expect(page).toHaveURL(/#single$/);
	await moshSingle(page);
	await expect(page).toHaveURL(/#single\/[^/]+$/);
	const first = page.url();

	await openSingle(page, "blue.png", BLUE);
	await moshSingle(page);
	const second = page.url();
	expect(second).not.toBe(first);

	// Pasted over the open edit: the editor swaps in place.
	await page.goto(first);
	await waitForRender(page);
	await expect(page).toHaveURL(first);
	await page.reload();
	await expect(page.locator(PREVIEW_CANVAS)).toBeVisible({ timeout: 30_000 });
	await expect(page).toHaveURL(first);

	// A dead link over an open edit keeps that edit and its link.
	await page.goto(first.replace(/#single\/.*/, "#single/gone"));
	await expect(page.getByText(GONE)).toBeVisible();
	await expect(page).toHaveURL(first);
	await expect(page.locator(PREVIEW_CANVAS)).toBeVisible();
});

test("a slideshow's link reopens it", async ({ page }) => {
	await page.goto("/");
	await selectMode(page, "Slideshow");
	await page
		.locator('input[type="file"][accept*="audio"]')
		.setInputFiles(trackFile("song.wav", { seconds: 3 }));
	await page
		.locator('input[type="file"][accept*="image/png"]')
		.setInputFiles([imageFile("red.png", RED), imageFile("blue.png", BLUE)]);
	await expect(page.locator(PREVIEW_CANVAS)).toBeAttached({ timeout: 30_000 });
	await expect(page).toHaveURL(/#slideshow\/[^/]+$/);
	const link = page.url();

	await page.goto("/");
	await page.goto(link);
	await expect(page.locator(PREVIEW_CANVAS)).toBeAttached({ timeout: 30_000 });
	await expect(page).toHaveURL(link);
});
