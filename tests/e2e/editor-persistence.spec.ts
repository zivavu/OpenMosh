import { expect, test } from "@playwright/test";
import {
	liveEffectNames,
	liveEffects,
	openEditor,
	PREVIEW_CANVAS,
	segmentMoshButton,
	segments,
	selectMode,
	selectSegment,
	splitSegmentAt,
	waitForRender,
} from "./app";
import { BLUE, GREEN, RED } from "./fixtures";

/**
 * Resuming an edit after a reload.
 *
 * Everything here crosses IndexedDB — the media pool, the timeline, and the
 * localStorage mirror the upload screen paints from before the database can
 * answer. None of it is reachable from the unit suite, and the failure mode is
 * the worst one the app has: work that looks saved and isn't.
 *
 * Note the source counts. The pool belongs to the song, the file the editor
 * opened with included — the media layer draws from it, so it has to come back
 * with the rest. A sequence started from three files is a saved sequence of
 * three, and one started from a single file is a sequence of one.
 */

/** The debounce behind the timeline write, plus room for the round-trip. */
const SAVE_SETTLE_MS = 2500;

/** Back to the upload screen and into the list of songs worked on. */
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
	await selectSegment(page, 0);
	await segmentMoshButton(page).click();
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

	await splitSegmentAt(page, 0.5);
	await selectSegment(page, 0);
	await segmentMoshButton(page).click();
	await expect(liveEffects(page)).not.toHaveCount(0);
	const rolled = await liveEffectNames(page);
	expect(rolled.length).toBeGreaterThan(0);
	await page.waitForTimeout(SAVE_SETTLE_MS);

	await reopenSavedSong(page);

	// The cut survived.
	await expect(segments(page)).toHaveCount(2);
	// The whole pool came back, not just the source the clips point at.
	await expect(page.getByText("3 SOURCES")).toBeVisible();
	// And the chain is the one that was rolled, effect for effect.
	await selectSegment(page, 0);
	expect(await liveEffectNames(page)).toEqual(rolled);
	// The segment that was never moshed is still clean, rather than inheriting
	// its neighbour's chain on the way through storage.
	await selectSegment(page, 1);
	await expect(liveEffects(page)).toHaveCount(0);
});

test("counts every source the editor opened with in the song's pool", async ({
	page,
}) => {
	// The pool belongs to the song now, the file the editor opened with
	// included: the media layer draws from it, so it has to come back with the
	// rest. Three files in is an offer of three.
	await openEditor(page, {
		sources: [
			["red.png", RED],
			["green.png", GREEN],
			["blue.png", BLUE],
		],
	});
	await waitForRender(page);
	await splitSegmentAt(page, 0.5);
	await page.waitForTimeout(SAVE_SETTLE_MS);

	await page.goto("/");
	await selectMode(page, "Editor");
	await expect(page.locator(".saved-item .saved-count")).toHaveText("3 srcs");
});

test("a sequence opened from one file is offered back with it", async ({
	page,
}) => {
	// The one file is the whole pool, and the pool is the song's — so a
	// single-file edit is as resumable as any other.
	await openEditor(page, { sources: [["red.png", RED]] });
	await waitForRender(page);
	await splitSegmentAt(page, 0.5);
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
	await splitSegmentAt(page, 0.25);
	await splitSegmentAt(page, 0.75);
	await expect(segments(page)).toHaveCount(3);
	await page.waitForTimeout(SAVE_SETTLE_MS);

	// A reload, not a navigation: this is the tab being refreshed out from under
	// the editor, which is what the pagehide flush exists to catch.
	await page.reload();
	await reopenSavedSong(page);
	await expect(segments(page)).toHaveCount(3);
});

test("starts clean when there's nothing stored yet", async ({ page }) => {
	// Guards the specs above: they'd pass on a database left behind by an
	// earlier run just as happily as on the state they actually created.
	await page.goto("/");
	await selectMode(page, "Editor");
	await expect(page.locator(".saved-item")).toHaveCount(0);
});
