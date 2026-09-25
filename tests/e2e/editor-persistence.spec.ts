import { expect, test } from "@playwright/test";
import {
	liveEffectNames,
	liveEffects,
	openEditor,
	PREVIEW_CANVAS,
	clipMoshButton,
	mediaClips,
	selectMode,
	selectClip,
	splitClipAt,
	waitForRender,
} from "./app";
import { BLUE, GREEN, RED } from "./fixtures";

/** Resuming an edit after a reload. Everything here crosses IndexedDB (the media pool,
 * the timeline, the localStorage mirror); the failure mode is work that looks saved and isn't. */

/** The debounce behind the timeline write, plus room for the round-trip. */
const SAVE_SETTLE_MS = 2500;

async function reopenSavedSong(page: import("@playwright/test").Page) {
	await page.goto("/");
	await selectMode(page, "Editor");
	await page.locator(".saved-item").first().click();
	await expect(page.locator(PREVIEW_CANVAS)).toBeVisible({ timeout: 30_000 });
	await waitForRender(page);
}

test.beforeEach(async ({ page }) => {
	page.on("pageerror", (error) => {
		throw new Error(`uncaught page error: ${error.message}`);
	});
});

test("a song worked on is offered back on the upload screen", async ({
	page,
}) => {
	await openEditor(page, {
		sources: [
			["red.png", RED],
			["green.png", GREEN],
		],
	});
	await waitForRender(page);
	await selectClip(page, 0);
	await clipMoshButton(page).click();
	await expect(liveEffects(page)).not.toHaveCount(0);
	await page.waitForTimeout(SAVE_SETTLE_MS);

	await page.goto("/");
	await selectMode(page, "Editor");
	await expect(page.locator(".recent-head .rack-label")).toHaveText("Recent");
	await expect(page.locator(".saved-item")).toHaveCount(1);
	await expect(page.locator(".saved-item")).toContainText("track.wav");
});

test("reopening it restores the cuts, the pool and every chain", async ({
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
	await page.waitForTimeout(SAVE_SETTLE_MS);

	await reopenSavedSong(page);

	await expect(mediaClips(page)).toHaveCount(2);
	// The whole pool came back, not just the source the clips point at.
	await expect(page.getByText("3 SOURCES")).toBeVisible();
	await selectClip(page, 0);
	expect(await liveEffectNames(page)).toEqual(rolled);
	// The clip never moshed is still clean, not inheriting its neighbour's chain.
	await selectClip(page, 1);
	await expect(liveEffects(page)).toHaveCount(0);
});

test("counts every source the editor opened with in the song's pool", async ({
	page,
}) => {
	// The pool belongs to the song, the opening file included, so three files in is three back.
	await openEditor(page, {
		sources: [
			["red.png", RED],
			["green.png", GREEN],
			["blue.png", BLUE],
		],
	});
	await waitForRender(page);
	await splitClipAt(page, 0.5);
	await page.waitForTimeout(SAVE_SETTLE_MS);

	await page.goto("/");
	await selectMode(page, "Editor");
	await expect(page.locator(".saved-item .saved-count")).toHaveText("3 srcs");
});

test("a sequence opened from one file is offered back with it", async ({
	page,
}) => {
	// The one file is the whole pool, and the pool is the song's, so this is as resumable as any.
	await openEditor(page, { sources: [["red.png", RED]] });
	await waitForRender(page);
	await splitClipAt(page, 0.5);
	await page.waitForTimeout(SAVE_SETTLE_MS);

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
	await page.waitForTimeout(SAVE_SETTLE_MS);

	// A reload, not a navigation: the tab refreshed out from under the editor.
	await page.reload();
	await reopenSavedSong(page);
	await expect(mediaClips(page)).toHaveCount(3);
});

test("starts clean when there's nothing stored yet", async ({ page }) => {
	// Guards the specs above: they'd pass on a database left by an earlier run just as happily.
	await page.goto("/");
	await selectMode(page, "Editor");
	await expect(page.locator(".saved-item")).toHaveCount(0);
});
