import { expect, test, type Page } from "@playwright/test";
import { openEditor, selectClip, waitForRender } from "./app";
import { RED } from "./fixtures";

/** Edit media opens from the rail and from a clip's panel, and both report to one
 * flag. A clip panel's editor once fought the rail's "closed" in an endless update loop. */

const errors: string[] = [];

test.beforeEach(async ({ page }) => {
	errors.length = 0;
	page.on("pageerror", (error) => errors.push(error.message));
	page.on("console", (msg) => {
		if (msg.type() === "error") errors.push(msg.text());
	});
});

function editDialog(page: Page) {
	return page.getByRole("dialog", { name: "Edit media" });
}

async function closeAndCheck(page: Page) {
	await editDialog(page).getByRole("button", { name: "Close" }).click();
	await expect(editDialog(page)).toBeHidden();
	expect(
		errors.filter((e) => /effect_update_depth|update depth/i.test(e)),
	).toEqual([]);
}

test("an image opens in Edit media from its clip's panel", async ({ page }) => {
	await openEditor(page, { sources: [["red.png", RED]] });
	await waitForRender(page);
	await selectClip(page, 0);

	await page.getByRole("button", { name: "Edit red.png" }).last().click();
	await expect(editDialog(page)).toBeVisible();
	// The loop took a few frames to blow up; give it time to.
	await page.waitForTimeout(500);
	await expect(editDialog(page)).toBeVisible();
	await closeAndCheck(page);
});

test("an image opens in Edit media from the rail", async ({ page }) => {
	await openEditor(page, { sources: [["red.png", RED]] });
	await waitForRender(page);
	await selectClip(page, 0);

	const railEdit = page.locator(".rail-edit").first();
	await railEdit.hover({ force: true });
	await railEdit.click({ force: true });
	await expect(editDialog(page)).toBeVisible();
	await page.waitForTimeout(500);
	await expect(editDialog(page)).toBeVisible();
	await closeAndCheck(page);
});
