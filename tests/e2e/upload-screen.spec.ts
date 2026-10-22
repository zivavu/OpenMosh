import { expect, test } from "@playwright/test";
import { modeToggle, selectMode } from "./app";
import { BLUE, GREEN, imageFile, RED } from "./fixtures";

test("switching modes moves neither the tabs nor the panel", async ({
	page,
}) => {
	await page.goto("/");
	const boxes = [];
	for (const mode of ["Single", "Editor", "Slideshow"] as const) {
		await selectMode(page, mode);
		const tabs = (await modeToggle(page).boundingBox())!;
		const panel = (await page.locator(".panel").boundingBox())!;
		boxes.push({ tabsY: tabs.y, panelY: panel.y, height: panel.height });
	}
	expect(boxes[1]).toEqual(boxes[0]);
	expect(boxes[2]).toEqual(boxes[0]);
});

test("a second slideshow drop before the song adds to the first", async ({
	page,
}) => {
	await page.goto("/");
	await selectMode(page, "Slideshow");
	const media = page.locator('input[type="file"][accept*="image/png"]');
	await media.setInputFiles([
		imageFile("red.png", RED),
		imageFile("blue.png", BLUE),
	]);
	await expect(
		page.getByText("2 files ready. Add a song to start."),
	).toBeVisible();
	await media.setInputFiles([imageFile("green.png", GREEN)]);
	await expect(
		page.getByText("3 files ready. Add a song to start."),
	).toBeVisible();
});
