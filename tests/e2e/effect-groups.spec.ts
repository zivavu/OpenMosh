import { expect, test, type Locator, type Page } from "@playwright/test";
import { liveEffects, openSingle, waitForRender } from "./app";
import { RED } from "./fixtures";

/** With live effects listed first, dragging a row across the divider switches it: into
 * the live group turns it on, out of it turns it off. */

test.beforeEach(async ({ page }) => {
	page.on("pageerror", (error) => {
		throw new Error(`uncaught page error: ${error.message}`);
	});
});

const rows = (page: Page) => page.locator(".effect-item");
const offRows = (page: Page) => page.locator(".effect-item:not(.enabled)");

/** Drag by the row's handle onto the lower half of `onto`, so it lands below it. */
async function dragRow(page: Page, row: Locator, onto: Locator) {
	await row.hover();
	await row.locator(".drag-handle").hover();
	await page.mouse.down();
	const box = (await onto.boundingBox())!;
	await page.mouse.move(box.x + box.width / 2, box.y + box.height * 0.75, {
		steps: 12,
	});
	await page.mouse.up();
}

test("dragging across the divider switches the effect", async ({ page }) => {
	await openSingle(page, "red.png", RED);
	await waitForRender(page);
	await page.getByRole("button", { name: "List live effects first" }).click();

	await rows(page).first().locator(".toggle").click();
	await expect(liveEffects(page)).toHaveCount(1);
	const liveName = await liveEffects(page).first().locator(".name").innerText();

	const incoming = offRows(page).nth(2);
	const incomingName = await incoming.locator(".name").innerText();
	await dragRow(page, incoming, liveEffects(page).first());
	await expect(liveEffects(page)).toHaveCount(2);
	await expect(liveEffects(page).nth(1).locator(".name")).toHaveText(
		incomingName,
	);

	await dragRow(page, liveEffects(page).first(), offRows(page).nth(3));
	await expect(liveEffects(page)).toHaveCount(1);
	await expect(liveEffects(page).first().locator(".name")).toHaveText(
		incomingName,
	);
	await expect(offRows(page).filter({ hasText: liveName })).toHaveCount(1);
});
