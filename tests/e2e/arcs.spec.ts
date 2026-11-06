import { readFileSync } from "node:fs";
import { expect, test, type Page } from "@playwright/test";
import {
	addMediaLane,
	canvasStats,
	dragSourceToLane,
	mediaClips,
	openEditor,
	PREVIEW_CANVAS,
	railThumbs,
	recordButton,
	selectMode,
	waitForRender,
	waitForSaved,
} from "./app";
import { trackFile } from "./fixtures";

/** Arcs in the editor: only there with music to follow, drawn over the layers below,
 * and carried through a save and an export. Every spec fails on a WebGL complaint, since
 * a draw WebGL refuses leaves the frame empty and says so only on the console. */

/** A blank check reads pure black as nothing drawn yet. */
const DIM = { r: 30, g: 30, b: 30 };
const BASE_BRIGHTNESS = 90;
/** The dropped clip lasts 20 seconds, so the song has to outlast it. */
const TRACK_SECONDS = 30;

function collectGlErrors(page: Page): string[] {
	const errors: string[] = [];
	page.on("console", (msg) => {
		if (/GL_INVALID|WebGL:/.test(msg.text())) errors.push(msg.text());
	});
	return errors;
}

const brightness = async (page: Page) => {
	const { mean } = await canvasStats(page);
	return mean.r + mean.g + mean.b;
};

const generate = (page: Page) =>
	page.getByRole("button", { name: "Generate" }).first();
const addArcs = (page: Page) => page.getByRole("button", { name: "Add Arcs" });

/** Over a flat dim layer, so anything brighter on the canvas is Arcs. */
async function openWithArcs(page: Page, seconds = TRACK_SECONDS) {
	await openEditor(page, {
		sources: [["dim.png", DIM]],
		track: { seconds },
	});
	await waitForRender(page);
	await addMediaLane(page);
	await generate(page).click();
	await addArcs(page).click();
	await expect(railThumbs(page)).toHaveCount(2);
	await dragSourceToLane(page, { thumb: 1, lane: 1, fraction: 0.01 });
	await expect(mediaClips(page, 1)).toHaveCount(1);
}

/** The click track's hits are short, so sample while it plays. */
async function expectLitWhilePlaying(page: Page) {
	await page.keyboard.press("Space");
	await expect
		.poll(() => brightness(page), {
			message: "Arcs never lit the canvas",
			timeout: 30_000,
		})
		.toBeGreaterThan(BASE_BRIGHTNESS + 6);
	await page.keyboard.press("Space");
}

test.beforeEach(async ({ page }) => {
	page.on("pageerror", (error) => {
		throw new Error(`uncaught page error: ${error.message}`);
	});
});

test("can't be added without a lane to follow", async ({ page }) => {
	await openEditor(page, { sources: [["dim.png", DIM]], track: null });
	await waitForRender(page);
	await generate(page).click();
	await expect(addArcs(page)).toBeDisabled();
	await expect(page.getByText("turn on Drives")).toBeVisible();
});

test.describe("from the upload screen", () => {
	const openGenerate = async (page: Page) => {
		await page.goto("/");
		await selectMode(page, "Editor");
	};

	test("waits for a song", async ({ page }) => {
		await openGenerate(page);
		await generate(page).click();
		await expect(addArcs(page)).toBeDisabled();
		await expect(page.getByText("add a song first")).toBeVisible();
	});

	test("isn't offered outside the editor", async ({ page }) => {
		await page.goto("/");
		await selectMode(page, "Slideshow");
		await generate(page).click();
		await expect(addArcs(page)).toHaveCount(0);
	});

	test("opens the editor with Arcs on a lane over the song", async ({
		page,
	}) => {
		const glErrors = collectGlErrors(page);
		await openGenerate(page);
		await page
			.locator('input[type="file"][accept*="audio"]')
			.setInputFiles(trackFile("song.wav", { seconds: TRACK_SECONDS }));
		await generate(page).click();
		await addArcs(page).click();

		await expect(page.locator(PREVIEW_CANVAS)).toBeVisible({ timeout: 30_000 });
		await expect(railThumbs(page)).toHaveCount(1);
		await expect(mediaClips(page, 0)).toHaveCount(1);
		await expect(page.getByRole("group", { name: /Audio 1/ })).toContainText(
			"song.wav",
		);
		// Nothing under it, so anything lit on the canvas is Arcs.
		await page.keyboard.press("Space");
		await expect
			.poll(() => brightness(page), {
				message: "Arcs never lit the canvas",
				timeout: 30_000,
			})
			.toBeGreaterThan(6);
		await page.keyboard.press("Space");
		expect(glErrors).toEqual([]);
	});
});

test("the canvas holds premultiplied colour, so a glow can't turn into a wash", async ({
	page,
}) => {
	await page.goto("/");
	await selectMode(page, "Editor");
	await page
		.locator('input[type="file"][accept*="audio"]')
		.setInputFiles(trackFile("song.wav", { seconds: TRACK_SECONDS }));
	await generate(page).click();
	await addArcs(page).click();
	await expect(page.locator(PREVIEW_CANVAS)).toBeVisible({ timeout: 30_000 });
	await page.keyboard.press("Space");
	await expect
		.poll(() => brightness(page), { timeout: 30_000 })
		.toBeGreaterThan(6);
	await page.keyboard.press("Space");

	const readCanvas = () =>
		page.evaluate((selector) => {
			const canvas = document.querySelector(selector) as HTMLCanvasElement;
			const gl = canvas.getContext("webgl2")!;
			const w = gl.drawingBufferWidth;
			const h = gl.drawingBufferHeight;
			const px = new Uint8Array(w * h * 4);
			gl.bindFramebuffer(gl.FRAMEBUFFER, null);
			gl.readPixels(0, 0, w, h, gl.RGBA, gl.UNSIGNED_BYTE, px);
			let covered = 0;
			let overAlpha = 0;
			for (let i = 0; i < px.length; i += 4) {
				if (px[i + 3] > 0) covered++;
				if (Math.max(px[i], px[i + 1], px[i + 2]) > px[i + 3] + 1) overAlpha++;
			}
			return {
				premultiplied: gl.getContextAttributes()!.premultipliedAlpha,
				covered,
				overAlpha,
			};
		}, PREVIEW_CANVAS);
	// Pausing redraws the frame, so the canvas can be clear for a moment.
	await expect
		.poll(async () => (await readCanvas()).covered)
		.toBeGreaterThan(0);
	const { premultiplied, overAlpha } = await readCanvas();
	expect(premultiplied).toBe(true);
	expect(overAlpha).toBe(0);
});

test("draws from the song over the layer below", async ({ page }) => {
	const glErrors = collectGlErrors(page);
	await openWithArcs(page);
	await expectLitWhilePlaying(page);
	expect(glErrors).toEqual([]);
});

test("a clip's look undoes, and comes back on reload", async ({ page }) => {
	const glErrors = collectGlErrors(page);
	await openWithArcs(page);
	const palette = page.locator("#mc-arcs-palette");

	// Dropped clips start selected.
	await page.getByRole("tab", { name: "Media clip" }).click();
	await expect(page.locator("#mc-arcs-reaction")).toBeVisible();
	await page.locator("#mc-arcs-listen").selectOption("hats");
	await page.getByRole("button", { name: "Reroll" }).click();

	await palette.selectOption("Magma");
	await palette.blur();
	await page.keyboard.press("Control+z");
	await expect(palette).toHaveValue("Ice");

	await palette.selectOption("Magma");
	await waitForSaved(page);
	await page.goto("/");
	await selectMode(page, "Editor");
	await page.locator(".saved-item").first().click();
	await expect(page.locator(PREVIEW_CANVAS)).toBeVisible({ timeout: 30_000 });
	await waitForRender(page);
	await expect(railThumbs(page)).toHaveCount(2);
	await mediaClips(page, 1).first().click();
	await page.getByRole("tab", { name: "Media clip" }).click();
	await expect(palette).toHaveValue("Magma");
	await expectLitWhilePlaying(page);
	expect(glErrors).toEqual([]);
});

test("exports with Arcs in the frame", async ({ page }) => {
	const glErrors = collectGlErrors(page);
	// Short on purpose: the export renders every frame through a software rasterizer.
	await openWithArcs(page, 2);
	await recordButton(page).click();
	await page.selectOption("#rec-fps", "15");
	const download = page.waitForEvent("download", { timeout: 240_000 });
	await page.getByRole("button", { name: "Start Recording" }).click();
	const path = await (await download).path();
	expect(readFileSync(path).length).toBeGreaterThan(1000);
	expect(glErrors).toEqual([]);
});
