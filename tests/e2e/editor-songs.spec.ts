import { expect, test, type Page } from "@playwright/test";
import { openEditor, PREVIEW_CANVAS, waitForRender, waitForSaved } from "./app";
import { GREEN, trackFile } from "./fixtures";

/** The editor's song is the one its tempo is measured from and the library shows as
 * loaded. Its sound sits on an audio lane, beside any other sound added. */

test.beforeEach(async ({ page }) => {
	page.on("pageerror", (error) => {
		throw new Error(`uncaught page error: ${error.message}`);
	});
});

const audioClips = (page: Page) => page.locator(".audio-row .clip:not(.ghost)");

/** Sound picked from the lane toolbar. The library's own input comes first and only
 * lists a song; the editor's is last. */
async function addSoundFile(page: Page, name: string, seconds: number) {
	await page
		.locator('input[type="file"][accept*="audio"]')
		.last()
		.setInputFiles(trackFile(name, { seconds }));
}

/** A song added through the library's own input, which lists it without loading it. */
async function addToLibrary(page: Page, name: string, seconds: number) {
	const rows = await openLibrarySongs(page);
	const before = await rows.count();
	await page
		.locator('input[type="file"][accept*="audio"]')
		.first()
		.setInputFiles(trackFile(name, { seconds }));
	await expect(rows).toHaveCount(before + 1);
	return rows;
}

async function openLibrarySongs(page: Page) {
	const panel = page.locator(".library .panel");
	if ((await panel.getAttribute("aria-hidden")) === "true") {
		await page.getByTitle("Open projects and songs").click();
		await expect(panel).not.toHaveAttribute("aria-hidden", "true");
	}
	await page.getByRole("tab", { name: "Songs" }).click();
	return page.locator(".library .track-row");
}

async function openWithSong(page: Page) {
	await openEditor(page, {
		sources: [["green.png", GREEN]],
		track: { name: "first.wav", seconds: 4 },
	});
	await waitForRender(page);
	await waitForSaved(page);
	await expect(audioClips(page)).toHaveCount(1);
	await expect(audioClips(page)).toHaveAttribute("title", /^first\.wav/);
}

test("sound added beside the song lands on a lane of its own", async ({
	page,
}) => {
	await openWithSong(page);
	await addSoundFile(page, "voice.wav", 2);
	await expect(page.locator(".audio-row")).toHaveCount(2);
	await expect(audioClips(page)).toHaveCount(2);
	await expect(audioClips(page).filter({ hasText: "voice.wav" })).toHaveCount(
		1,
	);

	// The song stays the one loaded.
	const rows = await openLibrarySongs(page);
	await expect(rows.and(page.locator(".active"))).toContainText("first.wav");
});

test("picking another song moves the song's clips onto it", async ({
	page,
}) => {
	await openWithSong(page);
	const rows = await addToLibrary(page, "second.wav", 2);
	await rows.filter({ hasText: "second.wav" }).locator(".name-btn").click();
	await expect(rows.and(page.locator(".active"))).toContainText("second.wav");
	await expect(audioClips(page)).toHaveCount(1);
	for (const clip of await audioClips(page).all()) {
		await expect(clip).toHaveAttribute("title", /^second\.wav/);
	}
});

test("unloading the song takes its clips off the lanes, and other sound stays", async ({
	page,
}) => {
	await openWithSong(page);
	await addSoundFile(page, "voice.wav", 2);
	await expect(audioClips(page)).toHaveCount(2);

	const rows = await openLibrarySongs(page);
	await rows.filter({ hasText: "first.wav" }).locator(".name-btn").click();
	await expect(rows.and(page.locator(".active"))).toHaveCount(0);
	await expect(audioClips(page)).toHaveCount(1);
	await expect(audioClips(page)).toHaveAttribute("title", /^voice\.wav/);

	// Undo brings the song's clips back.
	await page.keyboard.press("Control+z");
	await expect(audioClips(page)).toHaveCount(2);
});

test("a reopened project keeps its song and its other sound", async ({
	page,
}) => {
	await openWithSong(page);
	await addSoundFile(page, "voice.wav", 2);
	await expect(audioClips(page)).toHaveCount(2);
	await waitForSaved(page);

	await page.reload();
	await expect(page.locator(PREVIEW_CANVAS)).toBeVisible({ timeout: 30_000 });
	await waitForRender(page);
	await expect(audioClips(page)).toHaveCount(2);
	await expect(audioClips(page).filter({ hasText: "first.wav" })).toHaveCount(
		1,
	);
	await expect(audioClips(page).filter({ hasText: "voice.wav" })).toHaveCount(
		1,
	);
	const rows = await openLibrarySongs(page);
	await expect(rows.and(page.locator(".active"))).toContainText("first.wav");
});
