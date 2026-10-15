import { expect, test, type Page } from "@playwright/test";
import { PREVIEW_CANVAS, selectMode } from "./app";
import { BLUE, imageFile, RED, trackFile } from "./fixtures";

test.beforeEach(async ({ page }) => {
	page.on("pageerror", (error) => {
		throw new Error(`uncaught page error: ${error.message}`);
	});
});

function fullscreenElement(page: Page) {
	return page.evaluate(() => document.fullscreenElement?.className ?? null);
}

test("the slideshow preview goes fullscreen and comes back", async ({
	page,
}) => {
	await page.goto("/");
	await selectMode(page, "Slideshow");
	await page
		.locator('input[type="file"][accept*="audio"]')
		.setInputFiles(trackFile("song.wav", { seconds: 3 }));
	await page
		.locator('input[type="file"][accept*="image/png"]')
		.setInputFiles([imageFile("red.png", RED), imageFile("blue.png", BLUE)]);
	await expect(page.locator(PREVIEW_CANVAS)).toBeAttached({ timeout: 30_000 });

	await page.locator("body").press("f");
	await expect.poll(() => fullscreenElement(page)).toContain("preview-area");
	await expect(
		page.getByRole("button", { name: "Fullscreen preview" }),
	).toHaveClass(/\bon\b/);

	await page.getByTitle("Exit fullscreen (Esc)").click();
	await expect.poll(() => fullscreenElement(page)).toBeNull();

	await page.getByRole("button", { name: "Fullscreen preview" }).click();
	await expect.poll(() => fullscreenElement(page)).toContain("preview-area");
});
