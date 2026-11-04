import { expect, test } from "@playwright/test";
import { beatLaneBox, PREVIEW_CANVAS, selectMode } from "./app";
import { BLUE, imageFile, RED, trackFile } from "./fixtures";

test("S cuts the beat lane at the playhead, and undo takes it back", async ({
	page,
}) => {
	page.on("pageerror", (error) => {
		throw new Error(`uncaught page error: ${error.message}`);
	});
	await page.goto("/");
	await selectMode(page, "Slideshow");
	await page
		.locator('input[type="file"][accept*="audio"]')
		.setInputFiles(trackFile("song.wav", { seconds: 8 }));
	await page
		.locator('input[type="file"][accept*="image/png"]')
		.setInputFiles([imageFile("red.png", RED), imageFile("blue.png", BLUE)]);
	await expect(page.locator(PREVIEW_CANVAS)).toBeAttached({ timeout: 30_000 });

	const cuts = page.locator("line.seg");
	await expect(cuts).toHaveCount(1);

	// Nothing touched yet: S at the very start has no segment to split there.
	await page.keyboard.press("s");
	await expect(cuts).toHaveCount(1);

	const lane = await beatLaneBox(page);
	await page.mouse.click(lane.x + lane.width * 0.5, lane.y + lane.height - 2);

	await page.keyboard.press("s");
	await expect(cuts).toHaveCount(2);

	// The playhead now sits on the cut, so there is nothing more to split.
	await page.keyboard.press("s");
	await expect(cuts).toHaveCount(2);

	await page.keyboard.press("Control+z");
	await expect(cuts).toHaveCount(1);
});
