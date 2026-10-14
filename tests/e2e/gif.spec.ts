import { expect, test } from "@playwright/test";
import {
	nearestColor,
	PREVIEW_CANVAS,
	railThumbs,
	selectMode,
	waitForRender,
} from "./app";
import { BLUE, gifFile, RED, trackFile } from "./fixtures";

// A GIF is re-encoded to a video on the way in, so it can be seeked like one.
test("an animated GIF lands in the pool as a video, on its first frame", async ({
	page,
}) => {
	await page.goto("/");
	await selectMode(page, "Editor");
	await page
		.locator('input[type="file"][accept*="audio"]')
		.setInputFiles(trackFile());
	await page
		.locator('input[type="file"][accept*="image/png"]')
		.setInputFiles(gifFile("flash.gif", [RED, BLUE], 64, 500));
	await expect(page.locator(PREVIEW_CANVAS)).toBeVisible({ timeout: 30_000 });

	await expect(railThumbs(page)).toHaveCount(1);
	await expect(railThumbs(page).first().locator(".rail-kind")).toBeVisible();
	const first = await waitForRender(page);
	expect(nearestColor(first.mean, { RED, BLUE })).toBe("RED");
});
