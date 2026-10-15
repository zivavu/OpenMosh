import { expect, test, type Page } from "@playwright/test";
import { PREVIEW_CANVAS, selectMode, waitForSaved } from "./app";
import { BLUE, GREEN, imageFile, RED, trackFile } from "./fixtures";

/** Two slideshows on one song are two pieces of work: neither takes the other's
 * export settings. */

test.beforeEach(async ({ page }) => {
	page.on("pageerror", (error) => {
		throw new Error(`uncaught page error: ${error.message}`);
	});
});

async function newSlideshow(
	page: Page,
	images: ReturnType<typeof imageFile>[],
): Promise<string> {
	await page.goto("/");
	await selectMode(page, "Slideshow");
	await page
		.locator('input[type="file"][accept*="audio"]')
		.setInputFiles(trackFile("song.wav", { seconds: 3 }));
	await page
		.locator('input[type="file"][accept*="image/png"]')
		.setInputFiles(images);
	await expect(page.locator(PREVIEW_CANVAS)).toBeAttached({ timeout: 30_000 });
	await expect(page).toHaveURL(/#slideshow\/[^/]+$/);
	await waitForSaved(page);
	return page.url();
}

function outputWidth(page: Page) {
	return page.locator("#rs-width");
}

async function openOptions(page: Page): Promise<void> {
	await page.getByRole("button", { name: "Options", exact: true }).click();
	await expect(outputWidth(page)).toBeVisible();
}

test("a second slideshow on the same song keeps its own output size", async ({
	page,
}) => {
	const first = await newSlideshow(page, [
		imageFile("red.png", RED),
		imageFile("blue.png", BLUE),
	]);
	await openOptions(page);
	await outputWidth(page).fill("200");
	await outputWidth(page).press("Tab");
	await expect(outputWidth(page)).toHaveValue("200");

	const second = await newSlideshow(page, [imageFile("green.png", GREEN)]);
	expect(second).not.toBe(first);
	await openOptions(page);
	await expect(outputWidth(page)).toHaveValue("64");

	await page.goto("/");
	await page.goto(first);
	await expect(page.locator(PREVIEW_CANVAS)).toBeAttached({ timeout: 30_000 });
	await openOptions(page);
	await expect(outputWidth(page)).toHaveValue("200");
});
