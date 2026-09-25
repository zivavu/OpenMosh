import { expect, test, type Locator, type Page } from "@playwright/test";
import {
	openEditor,
	openSingle,
	selectMode,
	splitClipAt,
	waitForRender,
} from "./app";
import { BLUE, GREEN, RED } from "./fixtures";

/** The storage manager, end to end: real edits land in IndexedDB, the modal reads them
 * back grouped by song, and deleting empties both the database and the upload screen's list. */

/** The debounce behind the timeline and session writes, plus the round-trip. */
const SAVE_SETTLE_MS = 2500;

async function openStorage(page: Page): Promise<Locator> {
	await page.goto("/");
	await page.getByRole("button", { name: "Manage storage" }).click();
	const modal = page.getByRole("dialog", { name: "Storage" });
	await expect(modal).toBeVisible();
	// The inventory is read asynchronously; wait for it to land.
	await expect(modal.getByText("Reading…")).toHaveCount(0);
	return modal;
}

function confirmDelete(page: Page) {
	return page
		.getByRole("alertdialog")
		.getByRole("button", { name: "Delete", exact: true })
		.click();
}

/** Ids left in the song library, straight from the database. */
async function storedTrackNames(page: Page): Promise<string[]> {
	return page.evaluate(
		() =>
			new Promise<string[]>((resolve, reject) => {
				const req = indexedDB.open("openmosh-tracks");
				req.onerror = () => reject(req.error);
				req.onsuccess = () => {
					const db = req.result;
					if (!db.objectStoreNames.contains("tracks")) {
						db.close();
						resolve([]);
						return;
					}
					const all = db.transaction("tracks").objectStore("tracks").getAll();
					all.onsuccess = () => {
						db.close();
						resolve(
							(all.result as { name: string }[]).map((t) => t.name).sort(),
						);
					};
					all.onerror = () => reject(all.error);
				};
			}),
	);
}

/** Get a song's sequence saved, so it shows up as a project. */
async function buildSequence(page: Page, trackName: string): Promise<void> {
	await openEditor(page, {
		sources: [
			["red.png", RED],
			["green.png", GREEN],
			["blue.png", BLUE],
		],
		track: { name: trackName },
	});
	await waitForRender(page);
	await splitClipAt(page, 0.5);
	await page.waitForTimeout(SAVE_SETTLE_MS);
}

test.beforeEach(async ({ page }) => {
	page.on("pageerror", (error) => {
		throw new Error(`uncaught page error: ${error.message}`);
	});
});

test("a fresh browser has nothing to manage", async ({ page }) => {
	const modal = await openStorage(page);
	await expect(modal.getByText("Nothing stored yet")).toBeVisible();
	await expect(
		modal.getByRole("button", { name: "Delete everything" }),
	).toHaveCount(0);
});

test("a song worked on is listed as a project with its pooled media", async ({
	page,
}) => {
	await buildSequence(page, "track.wav");

	const modal = await openStorage(page);
	const row = modal.locator(".row", { hasText: "track.wav" });
	await expect(row).toHaveCount(1);
	await expect(row.locator(".mode")).toHaveText(["Editor"]);
	// The pool belongs to the song, the opening file included: three in is three.
	await expect(row).toContainText("3 files");

	await row.locator(".row-main").click();
	await expect(row.locator(".media")).toHaveCount(3);
	await expect(row.locator(".media")).toContainText([
		"red.png",
		"green.png",
		"blue.png",
	]);

	await expect(
		modal.locator(".legend-item", { hasText: "Media" }),
	).not.toContainText("0 B");
	await expect(
		modal.locator(".legend-item", { hasText: "Songs" }),
	).not.toContainText("0 B");
});

test("deleting a project empties the database and the upload screen's offer", async ({
	page,
}) => {
	await buildSequence(page, "track.wav");
	expect(await storedTrackNames(page)).toEqual(["track.wav"]);

	const modal = await openStorage(page);
	await modal.getByRole("button", { name: "Delete track.wav" }).click();
	await expect(page.getByRole("alertdialog")).toContainText("track.wav");
	await confirmDelete(page);

	await expect(modal.locator(".row", { hasText: "track.wav" })).toHaveCount(0);
	await expect(modal.getByText("Nothing stored yet")).toBeVisible();
	expect(await storedTrackNames(page)).toEqual([]);

	// Closing hands the change back to the upload screen, which stops offering the song.
	await modal.getByRole("button", { name: "Close" }).click();
	await expect(modal).toHaveCount(0);
	await selectMode(page, "Editor");
	await expect(page.locator(".saved-item")).toHaveCount(0);
});

test("cancelling the confirmation keeps the project", async ({ page }) => {
	await buildSequence(page, "track.wav");
	const modal = await openStorage(page);
	await modal.getByRole("button", { name: "Delete track.wav" }).click();
	await page
		.getByRole("alertdialog")
		.getByRole("button", { name: "Cancel" })
		.click();
	await expect(page.getByRole("alertdialog")).toHaveCount(0);
	await expect(modal.locator(".row", { hasText: "track.wav" })).toHaveCount(1);
	expect(await storedTrackNames(page)).toEqual(["track.wav"]);
});

test("select all and delete selected clears several projects at once", async ({
	page,
}) => {
	await buildSequence(page, "one.wav");
	await buildSequence(page, "two.wav");
	expect(await storedTrackNames(page)).toEqual(["one.wav", "two.wav"]);

	const modal = await openStorage(page);
	await expect(modal.locator(".row.selectable")).toHaveCount(2);
	await expect(modal.locator(".bulk")).toHaveCount(0);

	await modal.getByRole("checkbox", { name: "Select one.wav" }).check();
	await expect(modal.locator(".bulk")).toContainText("1 selected");
	const all = modal.getByRole("checkbox", { name: "Select all projects" });
	await expect(all).toHaveJSProperty("indeterminate", true);

	await all.click();
	await expect(modal.locator(".bulk")).toContainText("2 selected");
	await expect(all).toBeChecked();
	await all.click();
	await expect(modal.locator(".bulk")).toHaveCount(0);
	await all.click();
	await expect(modal.locator(".bulk")).toContainText("2 selected");

	await modal.getByRole("button", { name: "Delete selected" }).click();
	await expect(page.getByRole("alertdialog")).toContainText("2 items");
	await confirmDelete(page);

	await expect(modal.getByText("Nothing stored yet")).toBeVisible();
	expect(await storedTrackNames(page)).toEqual([]);
});

test("Clear drops the selection without deleting anything", async ({
	page,
}) => {
	await buildSequence(page, "track.wav");
	const modal = await openStorage(page);
	await modal.getByRole("checkbox", { name: "Select track.wav" }).check();
	await expect(modal.locator(".bulk")).toBeVisible();
	await modal.locator(".bulk").getByRole("button", { name: "Clear" }).click();
	await expect(modal.locator(".bulk")).toHaveCount(0);
	await expect(
		modal.getByRole("checkbox", { name: "Select track.wav" }),
	).not.toBeChecked();
	await expect(modal.locator(".row", { hasText: "track.wav" })).toHaveCount(1);
});

test("a single-mode edit with no song is listed without one, and deletable", async ({
	page,
}) => {
	await openSingle(page, "red.png", RED);
	await waitForRender(page);
	// A single session is only written once something was done to the image.
	await page.getByRole("button", { name: "MOSH", exact: true }).click();
	await page.waitForTimeout(SAVE_SETTLE_MS);

	const modal = await openStorage(page);
	await expect(modal.getByText("Without a song")).toBeVisible();
	const row = modal.locator(".row", { hasText: "red.png" });
	await expect(row).toHaveCount(1);
	await expect(row.locator(".mode")).toHaveText(["Single"]);
	await expect(
		modal.locator(".section-title", { hasText: "Projects" }),
	).toHaveCount(0);

	await modal.getByRole("button", { name: "Delete red.png" }).click();
	await confirmDelete(page);
	await expect(modal.getByText("Nothing stored yet")).toBeVisible();

	await modal.getByRole("button", { name: "Close" }).click();
	await expect(page.locator(".saved-item")).toHaveCount(0);
});

test("Delete everything wipes projects and song-less edits together", async ({
	page,
}) => {
	await openSingle(page, "red.png", RED);
	await waitForRender(page);
	await page.getByRole("button", { name: "MOSH", exact: true }).click();
	await page.waitForTimeout(SAVE_SETTLE_MS);
	await buildSequence(page, "track.wav");

	const modal = await openStorage(page);
	await expect(modal.locator(".row.selectable")).toHaveCount(2);
	await modal.getByRole("button", { name: "Delete everything" }).click();
	await confirmDelete(page);

	await expect(modal.getByText("Nothing stored yet")).toBeVisible();
	expect(await storedTrackNames(page)).toEqual([]);
	await modal.getByRole("button", { name: "Close" }).click();
	await expect(page.locator(".saved-item")).toHaveCount(0);
	await selectMode(page, "Editor");
	await expect(page.locator(".saved-item")).toHaveCount(0);
});

test("Escape closes the modal, but not while a confirmation is up", async ({
	page,
}) => {
	await buildSequence(page, "track.wav");
	const modal = await openStorage(page);
	await modal.getByRole("button", { name: "Delete track.wav" }).click();
	await page.keyboard.press("Escape");
	// The confirmation took the key; the modal behind it is still there.
	await expect(page.getByRole("alertdialog")).toHaveCount(0);
	await expect(modal).toBeVisible();
	await page.keyboard.press("Escape");
	await expect(modal).toHaveCount(0);
});
