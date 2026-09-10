import { devices, expect, test } from "@playwright/test";
import {
	effectItems,
	modeToggle,
	openSingle,
	sheetContent,
	sheetHandle,
	sheetTab,
	waitForRender,
} from "./app";
import { RED } from "./fixtures";

/**
 * The app on a phone. Everything else in this suite runs at a desktop size,
 * where the sidebar is a column and the mode toggle is there; this is the
 * layout where the sidebar folds into a bottom sheet and the timeline modes
 * are off the menu.
 */

// A touch device: `(pointer: coarse)` is what the app keys its mobile layout
// off, and the narrow viewport is what folds the sidebar into a sheet.
test.use({ ...devices["Pixel 5"] });

test.beforeEach(async ({ page }) => {
	page.on("pageerror", (error) => {
		throw new Error(`uncaught page error: ${error.message}`);
	});
});

test.describe("upload screen", () => {
	test("offers only single mode and says why", async ({ page }) => {
		await page.goto("/");
		await expect(modeToggle(page)).toHaveCount(0);
		await expect(page.locator(".mode-hint")).toContainText("desktop browser");
	});
});

test.describe("bottom sheet", () => {
	test("effects tab lists the chain", async ({ page }) => {
		await openSingle(page, "red.png", RED);
		await waitForRender(page);

		await sheetHandle(page).click();
		await expect(sheetTab(page, "Effects")).toHaveClass(/active/);
		// Scoped to the tab: the desktop column is still in the DOM, just not
		// displayed, and its chain would satisfy an unscoped query.
		const chain = effectItems(sheetContent(page));
		// The whole registry is listed, enabled or not — an empty tab means the
		// chain never rendered, not that nothing is switched on.
		await expect(chain.first()).toBeVisible();
		expect(await chain.count()).toBeGreaterThan(1);
	});

	test("settings tab is a tap away and back", async ({ page }) => {
		await openSingle(page, "red.png", RED);
		await waitForRender(page);

		await sheetHandle(page).click();
		await sheetTab(page, "Settings").click();
		await expect(sheetTab(page, "Settings")).toHaveClass(/active/);
		await expect(effectItems(sheetContent(page))).toHaveCount(0);
		await expect(sheetContent(page)).not.toBeEmpty();

		await sheetTab(page, "Effects").click();
		await expect(effectItems(sheetContent(page)).first()).toBeVisible();
	});
});
