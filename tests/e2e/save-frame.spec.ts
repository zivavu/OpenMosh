import { readFileSync } from "node:fs";
import { expect, test, type Page } from "@playwright/test";
import {
	canvasStats,
	dragSourceToLane,
	mediaClips,
	nearestColor,
	openEditor,
	openSingle,
	PREVIEW_CANVAS,
	selectMode,
	splitClipAt,
	waitForRender,
	waitForSaved,
} from "./app";
import { BLUE, GREEN, imageFile, RED, trackFile, type Rgb } from "./fixtures";

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

test("an editor on PNG saves the frame under the playhead", async ({
	page,
}) => {
	await openEditor(page, {
		sources: [
			["red.png", RED],
			["blue.png", BLUE],
		],
		track: { seconds: 4 },
	});
	await waitForRender(page);
	await splitClipAt(page, 0.5);
	await expect(mediaClips(page)).toHaveCount(2);
	await dragSourceToLane(page, { thumb: 1, fraction: 0.75 });
	await expect(mediaClips(page).nth(1)).toContainText("blue.png");

	await page.getByRole("button", { name: "Mosh settings" }).click();
	await page.getByRole("button", { name: "PNG", exact: true }).click();
	const save = page.getByRole("button", { name: "SAVE", exact: true });
	await expect(save).toBeVisible();

	const ruler = page.getByRole("slider", { name: "Start marker" });
	const box = (await ruler.boundingBox())!;
	for (const [fraction, color] of [
		[0.75, "blue"],
		[0.25, "red"],
	] as const) {
		await ruler.click({
			position: { x: box.width * fraction, y: box.height / 2 },
		});
		await expect
			.poll(async () => nearestColor((await canvasStats(page)).mean, PALETTE))
			.toBe(color);
		const download = page.waitForEvent("download");
		await save.click();
		const file = await download;
		expect(file.suggestedFilename()).toMatch(/\.png$/);
		const saved = await savedImageMean(page, (await file.path())!);
		expect(nearestColor(saved, PALETTE)).toBe(color);
	}
});

test("saves the single-mode frame", async ({ page }) => {
	await openSingle(page, "blue.png", BLUE, { size: OUTGROWS_PREVIEW });
	await waitForRender(page);

	expect(nearestColor(await saveAndMeasure(page), PALETTE)).toBe("blue");
});

test("saves the slideshow's frame", async ({ page }) => {
	await page.goto("/");
	await selectMode(page, "Slideshow");
	await page
		.locator('input[type="file"][accept*="audio"]')
		.setInputFiles(trackFile("song.wav", { seconds: 3 }));
	await page
		.locator('input[type="file"][accept*="image/png"]')
		.setInputFiles([
			imageFile("green.png", GREEN, OUTGROWS_PREVIEW),
			imageFile("green2.png", GREEN, OUTGROWS_PREVIEW),
		]);
	// A new slideshow opens on its grid; the preview canvas is there, just hidden.
	await expect(page.locator(PREVIEW_CANVAS)).toBeAttached({ timeout: 30_000 });
	await waitForRender(page);

	expect(nearestColor(await saveAndMeasure(page), PALETTE)).toBe("green");
});
