import { expect, test, type Page } from "@playwright/test";
import {
	liveEffectNames,
	liveEffects,
	openSingle,
	PREVIEW_CANVAS,
	saveProjectButton,
	selectMode,
	waitForRender,
	waitForSaved,
} from "./app";
import { BLUE, imageFile, RED, trackFile } from "./fixtures";

/** Single and slideshow edits saved to their own project files and opened back after
 * everything stored is gone, so the file is the only copy. */

test.beforeEach(async ({ page }) => {
	page.on("pageerror", (error) => {
		throw new Error(`uncaught page error: ${error.message}`);
	});
});

async function saveProjectFile(page: Page, extension: string): Promise<string> {
	const downloadPromise = page.waitForEvent("download");
	await saveProjectButton(page).click();
	const download = await downloadPromise;
	expect(download.suggestedFilename().endsWith(extension)).toBe(true);
	return (await download.path())!;
}

async function wipeStorage(page: Page): Promise<void> {
	await page.goto("/");
	await page.evaluate(async () => {
		localStorage.clear();
		// Back off, as the config set it: the demo starves a CI runner's CPU.
		localStorage.setItem(
			"openmosh-settings",
			JSON.stringify({ demoBackground: false }),
		);
		const dbs = await indexedDB.databases();
		await Promise.all(
			dbs.map(
				(db) =>
					new Promise<void>((resolve) => {
						if (!db.name) return resolve();
						const req = indexedDB.deleteDatabase(db.name);
						req.onsuccess = req.onerror = req.onblocked = () => resolve();
					}),
			),
		);
	});
	await page.reload();
}

/** Through the project picker, which only takes the mode on screen's files; the
 * browser's own filter doesn't bind a script, so a wrong file still gets through. */
async function openProjectFile(
	page: Page,
	extension: string,
	filePath: string,
): Promise<void> {
	await page.locator(`input[accept="${extension}"]`).setInputFiles(filePath);
}

test("a single edit saved to a file comes back with its mosh", async ({
	page,
}) => {
	await openSingle(page, "red.png", RED);
	await waitForRender(page);
	await page.getByRole("button", { name: "MOSH", exact: true }).click();
	await expect(liveEffects(page)).not.toHaveCount(0);
	const rolled = await liveEffectNames(page);
	await waitForSaved(page);
	const filePath = await saveProjectFile(page, ".openmosh-single");

	await wipeStorage(page);
	// The Editor turns a single edit's file down and says where it opens.
	await selectMode(page, "Editor");
	await page.locator('input[accept=".openmosh"]').setInputFiles(filePath);
	await expect(page.getByText("Switch to Single to open it")).toBeVisible();
	await expect(page.locator(PREVIEW_CANVAS)).toHaveCount(0);

	await selectMode(page, "Single");
	await expect(page.locator(".saved-item")).toHaveCount(0);
	await openProjectFile(page, ".openmosh-single", filePath);
	await expect(page.locator(PREVIEW_CANVAS)).toBeVisible({ timeout: 30_000 });
	await expect(page).toHaveURL(/#single\/[^/]+$/);
	await waitForRender(page);
	expect(await liveEffectNames(page)).toEqual(rolled);

	await page.goto("/");
	await selectMode(page, "Single");
	await expect(page.locator(".saved-item")).toHaveCount(1);
	await expect(page.locator(".saved-item")).toContainText("red.png");

	// The edit the file made is recognised as the file's from then on.
	await openProjectFile(page, ".openmosh-single", filePath);
	await expect(
		page.getByRole("alertdialog", { name: "Already in your projects" }),
	).toBeVisible();
});

test("a slideshow saved to a file comes back with its slides and song", async ({
	page,
}) => {
	await page.goto("/");
	await selectMode(page, "Slideshow");
	await page
		.locator('input[type="file"][accept*="audio"]')
		.setInputFiles(trackFile("song.wav", { seconds: 3 }));
	await page
		.locator('input[type="file"][accept*="image/png"]')
		.setInputFiles([imageFile("red.png", RED), imageFile("blue.png", BLUE)]);
	await expect(page.locator(PREVIEW_CANVAS)).toBeAttached({ timeout: 30_000 });
	await expect(page.locator(".slide-card")).toHaveCount(2);
	await waitForSaved(page);
	const filePath = await saveProjectFile(page, ".openmosh-slideshow");

	await wipeStorage(page);
	await selectMode(page, "Slideshow");
	await expect(page.locator(".saved-item")).toHaveCount(0);
	await openProjectFile(page, ".openmosh-slideshow", filePath);
	await expect(page).toHaveURL(/#slideshow\/[^/]+$/, { timeout: 30_000 });
	await expect(page.locator(PREVIEW_CANVAS)).toBeAttached({ timeout: 30_000 });

	await page.goto("/");
	await selectMode(page, "Slideshow");
	await expect(page.locator(".saved-item")).toHaveCount(1);
	await expect(page.locator(".saved-item")).toContainText("song.wav");
});
