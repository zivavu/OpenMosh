import { expect, test, type Page } from "@playwright/test";
import {
	liveEffectNames,
	liveEffects,
	openEditor,
	PREVIEW_CANVAS,
	clipMoshButton,
	mediaClips,
	projectMenuButton,
	selectMode,
	selectClip,
	splitClipAt,
	waitForRender,
	waitForSaved,
} from "./app";
import { BLUE, GREEN, RED } from "./fixtures";

/** Resuming an edit after a reload. Everything here crosses IndexedDB (the media pool,
 * the timeline, the localStorage mirror); the failure mode is work that looks saved and isn't. */

async function openSavedSong(page: Page) {
	await page.locator(".saved-item").first().click();
	await expect(page.locator(PREVIEW_CANVAS)).toBeVisible({ timeout: 30_000 });
	await waitForRender(page);
}

test.beforeEach(async ({ page }) => {
	page.on("pageerror", (error) => {
		throw new Error(`uncaught page error: ${error.message}`);
	});
});

test("a song worked on is offered back, and reopening it restores the cuts, the pool and every chain", async ({
	page,
}) => {
	await openEditor(page, {
		sources: [
			["red.png", RED],
			["green.png", GREEN],
			["blue.png", BLUE],
		],
	});
	await waitForRender(page);

	await splitClipAt(page, 0.5);
	await selectClip(page, 0);
	await clipMoshButton(page).click();
	await expect(liveEffects(page)).not.toHaveCount(0);
	const rolled = await liveEffectNames(page);
	expect(rolled.length).toBeGreaterThan(0);
	await waitForSaved(page);

	await page.goto("/");
	await selectMode(page, "Editor");
	await expect(page.locator(".recent-head .rack-label")).toHaveText("Recent");
	await expect(page.locator(".saved-item")).toHaveCount(1);
	await expect(page.locator(".saved-item")).toContainText("track.wav");
	// The pool belongs to the song, the opening file included, so three files in is three back.
	await expect(page.locator(".saved-item .saved-count")).toHaveText("3 srcs");
	await openSavedSong(page);

	await expect(mediaClips(page)).toHaveCount(2);
	// The whole pool came back, not just the source the clips point at.
	await expect(page.getByText("3 SOURCES")).toBeVisible();
	await selectClip(page, 0);
	expect(await liveEffectNames(page)).toEqual(rolled);
	// The clip never moshed is still clean, not inheriting its neighbour's chain.
	await selectClip(page, 1);
	await expect(liveEffects(page)).toHaveCount(0);
});

test("a sequence opened from one file is offered back with it", async ({
	page,
}) => {
	// The one file is the whole pool, and the pool is the song's, so this is as resumable as any.
	await openEditor(page, { sources: [["red.png", RED]] });
	await waitForRender(page);
	await splitClipAt(page, 0.5);
	await waitForSaved(page);

	await page.goto("/");
	await selectMode(page, "Editor");
	await expect(page.locator(".saved-item")).toHaveCount(1);
	await expect(page.locator(".saved-item .saved-count")).toHaveText("1 src");
});

test("a reload mid-edit doesn't lose the last change", async ({ page }) => {
	await openEditor(page, {
		sources: [
			["red.png", RED],
			["green.png", GREEN],
		],
	});
	await waitForRender(page);
	await splitClipAt(page, 0.25);
	await splitClipAt(page, 0.75);
	await expect(mediaClips(page)).toHaveCount(3);
	// Reloaded straight away, inside the save debounce: only the pagehide flush can keep the last cut.
	await page.reload();
	// The editor resumes the song it was on.
	await expect(page.locator(PREVIEW_CANVAS)).toBeVisible({ timeout: 30_000 });
	await waitForRender(page);
	await expect(mediaClips(page)).toHaveCount(3);
});

test("a project saved to a file comes back after storage is cleared", async ({
	page,
}) => {
	// The file picker is a native dialog Playwright can't drive; take the download path.
	await page.addInitScript(() => {
		Object.defineProperty(window, "showSaveFilePicker", {
			value: undefined,
			configurable: true,
		});
	});

	await openEditor(page, {
		sources: [
			["red.png", RED],
			["green.png", GREEN],
			["blue.png", BLUE],
		],
	});
	await waitForRender(page);
	await splitClipAt(page, 0.5);
	await selectClip(page, 0);
	await clipMoshButton(page).click();
	await expect(liveEffects(page)).not.toHaveCount(0);
	const rolled = await liveEffectNames(page);
	expect(rolled.length).toBeGreaterThan(0);
	await waitForSaved(page);

	// Save the whole project from the top bar's project menu.
	const downloadPromise = page.waitForEvent("download");
	await projectMenuButton(page).click();
	await page.getByRole("menuitem", { name: "Save project file" }).click();
	const download = await downloadPromise;
	expect(download.suggestedFilename()).toMatch(/\.openmosh$/);
	const filePath = await download.path();
	expect(filePath).toBeTruthy();

	// Wipe everything the app stored, so the file is the only copy left.
	await page.goto("/");
	await page.evaluate(async () => {
		localStorage.clear();
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
	await selectMode(page, "Editor");
	await expect(page.locator(".saved-item")).toHaveCount(0);

	// Open the file back through the upload screen's project picker.
	await page.locator('input[accept=".openmosh"]').setInputFiles(filePath!);
	await expect(page.locator(PREVIEW_CANVAS)).toBeVisible({ timeout: 30_000 });
	await waitForRender(page);

	// The cuts, the chain and the whole pool came back.
	await expect(mediaClips(page)).toHaveCount(2);
	await expect(page.getByText("3 SOURCES")).toBeVisible();
	await selectClip(page, 0);
	expect(await liveEffectNames(page)).toEqual(rolled);
	await selectClip(page, 1);
	await expect(liveEffects(page)).toHaveCount(0);
});
