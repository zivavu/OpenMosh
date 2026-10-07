import { readFileSync } from "node:fs";
import { expect, test, type Page } from "@playwright/test";
import {
	mediaClips,
	nearestColor,
	openEditor,
	openSingle,
	PREVIEW_CANVAS,
	waitForRender,
	waitForSaved,
} from "./app";
import { BLUE, GREEN, RED, type Rgb } from "./fixtures";

/** Ctrl+S saves the frame as an image. It re-renders at the output size first, so the
 * saved file can disagree with the preview: a reopened editor project once saved black. */

test.beforeEach(async ({ page }) => {
	page.on("pageerror", (error) => {
		throw new Error(`uncaught page error: ${error.message}`);
	});
});

async function saveAndMeasure(page: Page): Promise<Rgb> {
	const download = page.waitForEvent("download");
	await page.keyboard.press("ControlOrMeta+s");
	const file = await download;
	expect(file.suggestedFilename()).toMatch(/\.png$/);
	return savedImageMean(page, (await file.path())!);
}

/** Decode the saved image in the browser and average it. */
async function savedImageMean(page: Page, path: string): Promise<Rgb> {
	const base64 = readFileSync(path).toString("base64");
	return page.evaluate(async (data) => {
		const bytes = Uint8Array.from(atob(data), (c) => c.charCodeAt(0));
		const bitmap = await createImageBitmap(new Blob([bytes]));
		const canvas = new OffscreenCanvas(bitmap.width, bitmap.height);
		const ctx = canvas.getContext("2d")!;
		ctx.drawImage(bitmap, 0, 0);
		const px = ctx.getImageData(0, 0, bitmap.width, bitmap.height).data;
		let r = 0;
		let g = 0;
		let b = 0;
		for (let i = 0; i < px.length; i += 4) {
			r += px[i];
			g += px[i + 1];
			b += px[i + 2];
		}
		const n = px.length / 4;
		return { r: r / n, g: g / n, b: b / n };
	}, base64);
}

/** Bigger than the preview canvas, so the save has to re-render at the output size. */
const OUTGROWS_PREVIEW = 2000;

const PALETTE = {
	red: RED,
	green: GREEN,
	blue: BLUE,
	black: { r: 0, g: 0, b: 0 },
};

test("saves the editor's frame, not a black image", async ({ page }) => {
	await openEditor(page, {
		sources: [["red.png", RED]],
		track: { seconds: 3 },
		size: OUTGROWS_PREVIEW,
	});
	await waitForRender(page);
	expect(nearestColor(await saveAndMeasure(page), PALETTE)).toBe("red");

	// A reopened project draws only through its layers: the case that came out black.
	await waitForSaved(page);
	await page.reload();
	await expect(page.locator(PREVIEW_CANVAS)).toBeVisible({ timeout: 30_000 });
	await expect(mediaClips(page)).toHaveCount(1);
	await waitForRender(page);
	// The base turns blank once the restored sources are measured, with nothing to wait on.
	// Saving early still passes with the fix; it just stops catching the bug.
	await page.waitForTimeout(2000);
	expect(nearestColor(await saveAndMeasure(page), PALETTE)).toBe("red");
});

test("saves the single-mode frame", async ({ page }) => {
	await openSingle(page, "blue.png", BLUE, { size: OUTGROWS_PREVIEW });
	await waitForRender(page);

	expect(nearestColor(await saveAndMeasure(page), PALETTE)).toBe("blue");
});
