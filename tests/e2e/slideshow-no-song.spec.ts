import { expect, test, type Page } from "@playwright/test";
import { beatLaneBox, PREVIEW_CANVAS, selectMode, waitForSaved } from "./app";
import { BLUE, imageFile, RED, trackFile } from "./fixtures";

/** A slideshow with no song runs at a tempo and length set by hand, and saves. */

test.beforeEach(async ({ page }) => {
	page.on("pageerror", (error) => {
		throw new Error(`uncaught page error: ${error.message}`);
	});
});

function lengthField(page: Page) {
	return page
		.locator(".tl-tool-label", { hasText: "Length" })
		.locator("xpath=following-sibling::*[1]")
		.locator("input");
}

test("opens without a song, keeps its length and is offered back", async ({
	page,
}) => {
	await page.goto("/");
	await selectMode(page, "Slideshow");
	await page
		.locator('input[type="file"][accept*="image/png"]')
		.setInputFiles([imageFile("red.png", RED), imageFile("blue.png", BLUE)]);
	await expect(page.locator(PREVIEW_CANVAS)).toBeAttached({ timeout: 30_000 });
	await expect(page).toHaveURL(/#slideshow\/[^/]+$/);

	await lengthField(page).fill("12");
	await lengthField(page).press("Enter");
	await expect(lengthField(page)).toHaveValue("12");
	await waitForSaved(page);
	const url = page.url();

	await page.goto("/");
	await selectMode(page, "Slideshow");
	await expect(page.locator(".saved-item")).toHaveCount(1);

	await page.goto(url);
	await expect(page.locator(PREVIEW_CANVAS)).toBeAttached({ timeout: 30_000 });
	await expect(lengthField(page)).toHaveValue("12");
});

test("a cut past the slideshow's length survives reopening with its song", async ({
	page,
}) => {
	await page.goto("/");
	await selectMode(page, "Slideshow");
	await page
		.locator('input[type="file"][accept*="image/png"]')
		.setInputFiles([imageFile("red.png", RED), imageFile("blue.png", BLUE)]);
	await expect(page.locator(PREVIEW_CANVAS)).toBeAttached({ timeout: 30_000 });
	await lengthField(page).fill("2");
	await lengthField(page).press("Enter");
	await expect(lengthField(page)).toHaveValue("2");

	await page
		.locator('input[type="file"][accept="audio/*"]')
		.first()
		.setInputFiles(trackFile("song.wav", { seconds: 8 }));
	await expect(lengthField(page)).toBeHidden();

	const cuts = page.locator("line.seg");
	await expect(cuts).toHaveCount(1);
	const lane = await beatLaneBox(page);
	await page.keyboard.down("Control");
	await page.mouse.click(lane.x + lane.width * 0.75, lane.y + lane.height - 2);
	await page.keyboard.up("Control");
	await expect(cuts).toHaveCount(2);
	await waitForSaved(page);
	const url = page.url();

	await page.goto("/");
	await page.goto(url);
	await expect(page.locator(PREVIEW_CANVAS)).toBeAttached({ timeout: 30_000 });
	await expect(lengthField(page)).toBeHidden();
	await expect(cuts).toHaveCount(2);
	await waitForSaved(page);
	await page.reload();
	await expect(cuts).toHaveCount(2);
});
