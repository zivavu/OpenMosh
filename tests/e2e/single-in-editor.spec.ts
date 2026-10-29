import { expect, test } from "@playwright/test";
import {
	laneGutters,
	openEditor,
	openSingle,
	poolCount,
	PREVIEW_CANVAS,
	waitForRender,
	waitForSaved,
} from "./app";
import { GREEN, RED } from "./fixtures";

/** A saved single edit brought into the editor: its media on one clip that carries
 * the edit's chain and stays linked to it. */

test.beforeEach(async ({ page }) => {
	page.on("pageerror", (error) => {
		throw new Error(`uncaught page error: ${error.message}`);
	});
});

test("a single edit comes into the editor as one clip with its chain", async ({
	page,
}) => {
	await openSingle(page, "red.png", RED);
	await page.getByRole("button", { name: "MOSH", exact: true }).click();
	await waitForSaved(page);

	await openEditor(page, { sources: [["green.png", GREEN]] });
	await waitForRender(page);
	await page
		.getByTitle("Add one of your slideshows or single edits to the pool")
		.click();
	await page
		.getByRole("dialog")
		.getByRole("button", { name: /red\.png/ })
		.click();
	await expect(page.getByRole("dialog")).toHaveCount(0);

	await expect(poolCount(page)).toHaveText(/^2\s+sources$/i);
	await expect(laneGutters(page).filter({ hasText: "red.png" })).toHaveCount(1);
	const clip = page.locator(
		'.tl-row[data-lane-kind="media"] .clip:not(.ghost)[title^="red.png"]',
	);
	await expect(clip).not.toHaveAttribute("title", /clean/);

	await waitForSaved(page);
	await page.reload();
	await expect(page.locator(PREVIEW_CANVAS)).toBeVisible({ timeout: 30_000 });
	await waitForRender(page);
	await clip.click();
	await page.getByRole("tab", { name: "Media clip" }).click();
	await page.getByRole("button", { name: "Update from single edit" }).click();
	await expect(page.getByText(/^Updated/)).toBeVisible();
	await expect(poolCount(page)).toHaveText(/^2\s+sources$/i);
});
