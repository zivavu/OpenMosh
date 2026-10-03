import { expect, test, type Page } from "@playwright/test";
import { canvasStats, PREVIEW_CANVAS, selectMode } from "./app";
import { objCubeFile, RED, skinnedGlbFile, trackFile } from "./fixtures";

/**
 * 3D models in the editor's canvas. A draw WebGL refuses leaves the frame empty and
 * says so only on the console, so every spec here also fails on a WebGL complaint.
 */

function collectGlErrors(page: Page): string[] {
	const errors: string[] = [];
	page.on("console", (msg) => {
		if (/GL_INVALID|WebGL:/.test(msg.text())) errors.push(msg.text());
	});
	return errors;
}

async function openModel(
	page: Page,
	model: { name: string; mimeType: string; buffer: Buffer },
): Promise<void> {
	await page.goto("/");
	await selectMode(page, "Editor");
	await page
		.locator('input[type="file"][accept*="audio"]')
		.setInputFiles(trackFile());
	await page
		.locator('input[type="file"][accept*="image/png"]')
		.setInputFiles(model);
	await expect(page.locator(PREVIEW_CANVAS)).toBeVisible({ timeout: 30_000 });
}

test("a still model draws on the canvas in its own colour", async ({
	page,
}) => {
	const glErrors = collectGlErrors(page);
	await openModel(page, objCubeFile("cube.obj", RED));

	// The front view fits the frame, so a drawn cube turns the frame red.
	await expect
		.poll(
			async () => {
				const { mean } = await canvasStats(page);
				return mean.r - Math.max(mean.g, mean.b);
			},
			{ message: "the cube never showed up", timeout: 30_000 },
		)
		.toBeGreaterThan(60);
	expect(glErrors).toEqual([]);
});

test("an animated model draws on the canvas", async ({ page }) => {
	const glErrors = collectGlErrors(page);
	await openModel(page, skinnedGlbFile("rig.glb"));

	await expect
		.poll(
			async () => {
				const { mean } = await canvasStats(page);
				return mean.r + mean.g + mean.b;
			},
			{ message: "the animated model never showed up", timeout: 30_000 },
		)
		.toBeGreaterThan(60);
	expect(glErrors).toEqual([]);
});
