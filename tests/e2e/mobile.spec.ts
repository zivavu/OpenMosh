import { devices, expect, test } from "@playwright/test";
import {
	actionBar,
	effectItems,
	laneGutters,
	layerButtons,
	modeToggle,
	openEditor,
	openSingle,
	segmentBar,
	selectSegment,
	sheetContent,
	sheetHandle,
	sheetTab,
	timelineStack,
	waitForRender,
} from "./app";
import { RED } from "./fixtures";

/** The app on a phone. Everything else runs at a desktop size, where the sidebar is a
 * column and the mode toggle is there; here it folds into a bottom sheet. */

// A touch device: `(pointer: coarse)` is what the app keys its mobile layout off.
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
		await expect(page.locator(".panel-hint")).toContainText("desktop browser");
	});
});

test.describe("bottom sheet", () => {
	test("chain tab lists the chain", async ({ page }) => {
		await openSingle(page, "red.png", RED);
		await waitForRender(page);

		await sheetHandle(page).click();
		await expect(sheetTab(page, "Chain")).toHaveClass(/active/);
		const chain = effectItems(sheetContent(page));
		// The whole registry is listed, enabled or not: an empty tab means the chain never rendered.
		await expect(chain.first()).toBeVisible();
		expect(await chain.count()).toBeGreaterThan(1);
	});

	test("mosh settings are a tap away and back", async ({ page }) => {
		await openSingle(page, "red.png", RED);
		await waitForRender(page);

		await sheetHandle(page).click();
		await sheetTab(page, "Mosh").click();
		await expect(sheetTab(page, "Mosh")).toHaveClass(/active/);
		await expect(effectItems(sheetContent(page))).toHaveCount(0);
		await expect(sheetContent(page)).not.toBeEmpty();

		await sheetTab(page, "Chain").click();
		await expect(effectItems(sheetContent(page)).first()).toBeVisible();
	});
});

test.describe("action bar", () => {
	// Narrower than the Pixel 5, at the width the bar used to overrun.
	test.use({ viewport: { width: 360, height: 740 } });

	test("keeps the layer lanes off a phone", async ({ page }) => {
		await openSingle(page, "red.png", RED);
		await expect(layerButtons(page)).toHaveCount(0);
	});

	test("fits every control on one row", async ({ page }) => {
		await openSingle(page, "red.png", RED);
		const bar = actionBar(page);
		await expect(bar).toBeVisible();
		const buttons = bar.locator("button");
		expect(await buttons.count()).toBeGreaterThan(2);
		const barBox = (await bar.boundingBox())!;
		for (const box of await buttons.evaluateAll((els) =>
			els.map((el) => el.getBoundingClientRect().toJSON()),
		)) {
			// Inside the bar's box horizontally, all on its first line: the wrap rule is a fallback.
			expect(box.left).toBeGreaterThanOrEqual(barBox.x);
			expect(box.right).toBeLessThanOrEqual(barBox.x + barBox.width);
			expect(box.top - barBox.y).toBeLessThan(barBox.height / 2);
		}
	});
});

test.describe("timeline", () => {
	test("gives the whole width to the lanes", async ({ page }) => {
		await openSingle(page, "red.png", RED, { track: {} });
		const stack = timelineStack(page);
		await expect(stack).toBeVisible();
		await expect(laneGutters(page).first()).toBeAttached();
		for (const gutter of await laneGutters(page).all()) {
			await expect(gutter).toBeHidden();
		}
		// The lane, not merely the row, spans the stack: a zero-width gutter still leaves its gap.
		const lane = stack.locator(".tl-lane").first();
		const laneBox = (await lane.boundingBox())!;
		const stackBox = (await stack.boundingBox())!;
		expect(laneBox.width).toBeGreaterThan(stackBox.width * 0.9);
	});
});

test.describe("segment bar in a narrow window", () => {
	// A desktop browser squeezed narrow, not a phone: the editor is not offered to touch devices.
	test.use({
		isMobile: false,
		hasTouch: false,
		viewport: { width: 400, height: 800 },
	});

	test("wraps instead of running off the edge", async ({ page }) => {
		await openEditor(page, { sources: [["red.png", RED]] });
		await waitForRender(page);
		await selectSegment(page, 0);

		const bar = segmentBar(page);
		await expect(bar).toBeVisible();
		const width = page.viewportSize()!.width;
		for (const box of await bar
			.locator("button, select")
			.evaluateAll((els) =>
				els.map((el) => el.getBoundingClientRect().toJSON()),
			)) {
			expect(box.left).toBeGreaterThanOrEqual(0);
			expect(box.right).toBeLessThanOrEqual(width);
		}
	});
});
