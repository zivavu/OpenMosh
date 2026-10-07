import { expect, test, type Page } from "@playwright/test";
import {
	openEditor,
	openSingle,
	selectMode,
	waitForRender,
	waitForSaved,
} from "./app";
import { RED } from "./fixtures";

/** Uploading a file or song that already has a saved project starts a second project
 * next to it. It used to land on the first one's key and overwrite its work. */

test.beforeEach(async ({ page }) => {
	page.on("pageerror", (error) => {
		throw new Error(`uncaught page error: ${error.message}`);
	});
});

async function moshSingle(page: Page) {
	await waitForRender(page);
	await page.getByRole("button", { name: "MOSH", exact: true }).click();
	await waitForSaved(page);
}

async function recentRows(page: Page, mode: "Single" | "Editor") {
	await page.goto("/");
	await selectMode(page, mode);
	return page.locator(".saved-item");
}

test("the same image twice in single mode is two projects", async ({
	page,
}) => {
	await openSingle(page, "photo.png", RED);
	await moshSingle(page);
	await openSingle(page, "photo.png", RED);
	await moshSingle(page);

	const rows = await recentRows(page, "Single");
	await expect(rows).toHaveCount(2);
	await expect(rows.filter({ hasText: "photo.png (2)" })).toHaveCount(1);
});

test("the same image and song twice in single mode is two projects", async ({
	page,
}) => {
	await openSingle(page, "photo.png", RED, { track: { name: "song.wav" } });
	await moshSingle(page);
	await openSingle(page, "photo.png", RED, { track: { name: "song.wav" } });
	await moshSingle(page);

	const rows = await recentRows(page, "Single");
	await expect(rows).toHaveCount(2);
	await expect(rows.filter({ hasText: "song.wav (2)" })).toHaveCount(1);
});

test("the same song twice in the editor is two projects", async ({ page }) => {
	for (let i = 0; i < 2; i++) {
		await openEditor(page, {
			sources: [["photo.png", RED]],
			track: { name: "song.wav" },
		});
		await waitForRender(page);
		await waitForSaved(page);
	}

	const rows = await recentRows(page, "Editor");
	await expect(rows).toHaveCount(2);
	await expect(rows.filter({ hasText: "song.wav (2)" })).toHaveCount(1);
});
