import { readFileSync } from "node:fs";
import { expect, test, type Page } from "@playwright/test";
import {
	clipMoshButton,
	liveEffectNames,
	liveEffects,
	mediaClips,
	openEditor,
	PREVIEW_CANVAS,
	recordButton,
	selectClip,
	selectMode,
	splitClipAt,
	waitForRender,
	waitForSaved,
} from "./app";
import { GREEN, RED } from "./fixtures";

/** The editor with no song: the upload screen lets it in, and the project still sizes
 * itself, saves, reopens and exports with nothing to take its length from. */

test.beforeEach(async ({ page }) => {
	page.on("pageerror", (error) => {
		throw new Error(`uncaught page error: ${error.message}`);
	});
});

const openWithoutSong = (page: Page) =>
	openEditor(page, {
		sources: [
			["red.png", RED],
			["green.png", GREEN],
		],
		track: null,
	});

function lengthField(page: Page) {
	return page
		.locator(".tl-tool-label", { hasText: "Length" })
		.locator("xpath=following-sibling::*[1]")
		.locator("input");
}

test("opens, edits, and reopens with its work", async ({ page }) => {
	await openWithoutSong(page);
	await waitForRender(page);
	await expect(mediaClips(page)).toHaveCount(1);
	// Nothing lends it a length, so it takes the default one.
	await expect(lengthField(page)).toHaveValue(/^\d+(\.\d)?$/);

	await splitClipAt(page, 0.5);
	await selectClip(page, 0);
	await clipMoshButton(page).click();
	await expect(liveEffects(page)).not.toHaveCount(0);
	const rolled = await liveEffectNames(page);
	await waitForSaved(page);

	await page.goto("/");
	await selectMode(page, "Editor");
	await expect(page.locator(".saved-item")).toHaveCount(1);
	await page.locator(".saved-item").first().click();
	await expect(page.locator(PREVIEW_CANVAS)).toBeVisible({ timeout: 30_000 });
	await waitForRender(page);
	await expect(mediaClips(page)).toHaveCount(2);
	await selectClip(page, 0);
	expect(await liveEffectNames(page)).toEqual(rolled);
});

test("exports a playable WebM as long as the project", async ({ page }) => {
	await openWithoutSong(page);
	await waitForRender(page);
	// Short, so the software rasterizer gets through it.
	await lengthField(page).fill("2");
	await lengthField(page).press("Enter");
	await expect(lengthField(page)).toHaveValue("2");

	await recordButton(page).click();
	await page.selectOption("#rec-fps", "15");
	const download = page.waitForEvent("download", { timeout: 120_000 });
	await page.getByRole("button", { name: "Start Recording" }).click();
	const file = await download;
	const path = (await file.path())!;
	const bytes = readFileSync(path);
	expect([...bytes.subarray(0, 4)]).toEqual([0x1a, 0x45, 0xdf, 0xa3]);

	const duration = await page.evaluate(async (data) => {
		const raw = Uint8Array.from(atob(data), (c) => c.charCodeAt(0));
		const video = document.createElement("video");
		video.muted = true;
		video.src = URL.createObjectURL(new Blob([raw], { type: "video/webm" }));
		return new Promise<number | null>((resolve) => {
			video.onloadedmetadata = () => resolve(video.duration);
			video.onerror = () => resolve(null);
			setTimeout(() => resolve(null), 15_000);
		});
	}, bytes.toString("base64"));
	expect(duration, "the exported file wouldn't load as a video").not.toBeNull();
	expect(duration!).toBeGreaterThan(1.5);
	expect(duration!).toBeLessThan(3);
});
