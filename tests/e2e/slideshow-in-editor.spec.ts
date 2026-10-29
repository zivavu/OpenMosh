import { expect, test, type Page } from "@playwright/test";
import {
	canvasStats,
	chainBar,
	laneGutters,
	nearestColor,
	openEditor,
	poolCount,
	PREVIEW_CANVAS,
	selectMode,
	waitForRender,
	waitForSaved,
} from "./app";
import { BLUE, GREEN, imageFile, RED } from "./fixtures";

/** A saved slideshow brought into the editor: one clip that cuts between its slides on
 * the slideshow's own beat, with the slides kept out of the pool's way. */

test.beforeEach(async ({ page }) => {
	page.on("pageerror", (error) => {
		throw new Error(`uncaught page error: ${error.message}`);
	});
});

const PALETTE = { red: RED, green: GREEN, blue: BLUE };

/** A songless slideshow of a red and a blue slide, cutting every half second. */
async function saveSlideshow(page: Page) {
	await page.goto("/");
	await selectMode(page, "Slideshow");
	await page
		.locator('input[type="file"][accept*="image/png"]')
		.setInputFiles([imageFile("red.png", RED), imageFile("blue.png", BLUE)]);
	await expect(page.locator(PREVIEW_CANVAS)).toBeAttached({ timeout: 30_000 });
	await waitForSaved(page);
}

/** The editor on a green image, with the slideshow added on top and left unmoshed. */
async function addSlideshowToEditor(page: Page) {
	await openEditor(page, { sources: [["green.png", GREEN]] });
	await waitForRender(page);
	await expect(poolCount(page)).toHaveText(/^1\s+source$/i);

	await page
		.getByTitle("Add one of your slideshows or single edits to the pool")
		.click();
	await page
		.getByRole("dialog")
		.getByRole("button", { name: /2 images/ })
		.click();
	await expect(page.getByRole("dialog")).toHaveCount(0);

	// Its slides stay behind the slideshow: the pool gains one entry, not three.
	await expect(poolCount(page)).toHaveText(/^2\s+sources$/i);
	await expect(laneGutters(page).filter({ hasText: "2 images" })).toHaveCount(
		1,
	);
	// Auto rolls on the slideshow's own cuts, so the bar has no interval to pick.
	await expect(chainBar(page)).toContainText("each cut");
	await chainBar(page).getByRole("button", { name: "Static" }).click();
}

function slideshowClip(page: Page) {
	return page.locator(
		'.tl-row[data-lane-kind="media"] .clip:not(.ghost)[title^="2 images"]',
	);
}

async function previewColor(page: Page): Promise<string> {
	return nearestColor((await canvasStats(page)).mean, PALETTE);
}

test("a slideshow plays in the editor as one clip, cutting on its own beat", async ({
	page,
}) => {
	await saveSlideshow(page);
	await addSlideshowToEditor(page);

	await expect.poll(() => previewColor(page)).toBe("red");
	await page.keyboard.press(" ");
	const seen = new Set<string>();
	const until = Date.now() + 5_000;
	while (Date.now() < until && !seen.has("blue")) {
		seen.add(await previewColor(page));
		await page.waitForTimeout(50);
	}
	await page.keyboard.press(" ");
	expect(seen.has("blue"), "the preview never cut to the second slide").toBe(
		true,
	);
	expect(seen.has("green"), "the layer below showed through a cut").toBe(false);
});

test("a slideshow clip survives a reload and updates from its slideshow", async ({
	page,
}) => {
	await saveSlideshow(page);
	await addSlideshowToEditor(page);
	await waitForSaved(page);

	await page.reload();
	await expect(page.locator(PREVIEW_CANVAS)).toBeVisible({ timeout: 30_000 });
	await waitForRender(page);
	await expect(poolCount(page)).toHaveText(/^2\s+sources$/i);
	await expect.poll(() => previewColor(page)).toBe("red");

	await slideshowClip(page).click();
	await page.getByRole("tab", { name: "Media clip" }).click();
	await page.getByRole("button", { name: "Update from slideshow" }).click();
	await expect(page.getByText(/^Updated/)).toBeVisible();
	// The old freeze leaves the pool with the new one in its place.
	await expect(poolCount(page)).toHaveText(/^2\s+sources$/i);
	await expect.poll(() => previewColor(page)).toBe("red");
});
