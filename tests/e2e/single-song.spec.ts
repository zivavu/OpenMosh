import { expect, test, type Page } from "@playwright/test";
import { openSingle, PREVIEW_CANVAS, recordButton, waitForRender } from "./app";
import { RED, trackFile } from "./fixtures";

/** Single mode runs on its song when it has one, else on its video. Songs come and go
 * through the library, and the export length follows whichever is the clock. */

test.beforeEach(async ({ page }) => {
	page.on("pageerror", (error) => {
		throw new Error(`uncaught page error: ${error.message}`);
	});
});

/** The export length Record's settings show. Null when it's typed in, as for a still
 * with no song. */
async function exportLength(page: Page): Promise<string | null> {
	await recordButton(page).click();
	const popover = page.locator(".record-settings");
	await expect(popover).toBeVisible();
	const typed = popover.locator("#rec-duration");
	const shown = popover.getByText(/^\d+\.\ds$/);
	await expect(typed.or(shown)).toBeVisible();
	const value = (await typed.isVisible()) ? null : await shown.textContent();
	await recordButton(page).click();
	await expect(popover).toBeHidden();
	return value;
}

async function expectExportLength(page: Page, length: string | null) {
	await expect.poll(() => exportLength(page)).toBe(length);
}

/** Another song picked or dropped in single mode replaces the current one. The
 * library's own input comes first and only lists a song; the editor's is last. */
async function addSong(page: Page, name: string, seconds: number) {
	await page
		.locator('input[type="file"][accept*="audio"]')
		.last()
		.setInputFiles(trackFile(name, { seconds }));
}

/** The library's song rows, with the drawer open: a click elsewhere closes it. */
async function openLibrary(page: Page) {
	const panel = page.locator(".library .panel");
	if ((await panel.getAttribute("aria-hidden")) === "true") {
		await page.getByTitle(/^Open (projects and songs|track library)$/).click();
		await expect(panel).not.toHaveAttribute("aria-hidden", "true");
	}
	const songs = page.getByRole("tab", { name: "Songs" });
	if (await songs.isVisible()) await songs.click();
	const rows = page.locator(".library .track-row");
	await expect(rows.first()).toBeVisible();
	return rows;
}

async function openVideo(page: Page) {
	await page.goto("/");
	const bytes = await page.evaluate(async () => {
		const path = "/src/lib/testing/rotated-video.ts";
		const { rotatedMp4 } = await import(/* @vite-ignore */ path);
		return rotatedMp4("rgb(220,30,30)", "rgb(40,70,230)");
	});
	await page.locator('input[type="file"][accept*="image/png"]').setInputFiles({
		name: "clip.mp4",
		mimeType: "video/mp4",
		buffer: Buffer.from(bytes),
	});
	await expect(page.locator(PREVIEW_CANVAS)).toBeVisible({ timeout: 30_000 });
	await waitForRender(page);
}

test("a song sets a still's length, and the library swaps and unloads it", async ({
	page,
}) => {
	await openSingle(page, "photo.png", RED, {
		track: { name: "long.wav", seconds: 4 },
	});
	await waitForRender(page);
	await expectExportLength(page, "4.0s");

	await addSong(page, "short.wav", 2);
	await expectExportLength(page, "2.0s");

	const rows = await openLibrary(page);
	await expect(rows).toHaveCount(2);
	await expect(rows.and(page.locator(".active"))).toContainText("short.wav");
	await rows.filter({ hasText: "long.wav" }).locator(".name-btn").click();
	await expect(rows.and(page.locator(".active"))).toContainText("long.wav");
	await expectExportLength(page, "4.0s");

	// Clicking the loaded song unloads it: the still's length is typed in again.
	await openLibrary(page);
	await rows.filter({ hasText: "long.wav" }).locator(".name-btn").click();
	await expect(rows.and(page.locator(".active"))).toHaveCount(0);
	await expectExportLength(page, null);
});

test("the library's play button plays the loaded song and pauses it", async ({
	page,
}) => {
	await openSingle(page, "photo.png", RED, {
		track: { name: "song.wav", seconds: 4 },
	});
	await waitForRender(page);
	const rows = await openLibrary(page);
	const play = rows.and(page.locator(".active")).locator(".preview-btn");
	await expect(play).toHaveAttribute("title", "Play");
	await play.click();
	await expect(play).toHaveAttribute("title", "Pause");
	await play.click();
	await expect(play).toHaveAttribute("title", "Play");
});

test("a video runs on its own clock until a song comes in, and again once it goes", async ({
	page,
}) => {
	await openVideo(page);
	await expectExportLength(page, "1.0s");
	// At double speed the export runs half as long; the slider is log2 of the speed.
	await page.locator(".speed-slider").fill("1");
	await expectExportLength(page, "0.5s");
	await page.locator(".speed-slider").dblclick();
	await expectExportLength(page, "1.0s");

	// The transport plays the video while it's the clock.
	const play = page.getByRole("button", { name: /^(PLAY|STOP)$/ });
	await play.click();
	await expect(play).toHaveText(/STOP/);
	await play.click();
	await expect(play).toHaveText(/PLAY/);

	await addSong(page, "song.wav", 3);
	await expectExportLength(page, "3.0s");
	await play.click();
	await expect(play).toHaveText(/STOP/);
	await play.click();
	await expect(play).toHaveText(/PLAY/);

	const rows = await openLibrary(page);
	await rows.filter({ hasText: "song.wav" }).locator(".name-btn").click();
	await expect(rows.and(page.locator(".active"))).toHaveCount(0);
	await expectExportLength(page, "1.0s");
});
