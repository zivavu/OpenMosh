import { expect, test } from "@playwright/test";
import { openEditor, waitForRender } from "./app";
import { GREEN } from "./fixtures";

/** Recording the microphone onto an audio lane while the project plays along. */

test.beforeEach(async ({ page }) => {
	page.on("pageerror", (error) => {
		throw new Error(`uncaught page error: ${error.message}`);
	});
});

test("records a take onto an empty audio lane", async ({ page }) => {
	await openEditor(page, { sources: [["green.png", GREEN]] });
	await waitForRender(page);
	const rows = page.locator(".audio-row");
	// The song's own lane.
	await expect(rows).toHaveCount(1);
	await page.getByRole("button", { name: "Audio lane" }).click();
	await expect(rows).toHaveCount(2);
	const lane = rows.last();

	await lane.locator(".tl-gutter").hover();
	const record = lane.locator(".lane-record");
	await record.click();
	await expect(lane.locator(".clip.take")).toBeVisible();
	await page.waitForTimeout(1500);
	await record.click();

	await expect(lane.locator(".clip.take")).toHaveCount(0);
	const clip = lane.locator(".clip:not(.ghost)");
	await expect(clip).toHaveCount(1);
	await expect(clip).toHaveAttribute("title", /^Mic take/);
	// From the playhead at the start, about 1.5s of the 8s project.
	const box = await clip.evaluate((el) => ({
		left: parseFloat(el.style.left),
		width: parseFloat(el.style.width),
	}));
	expect(box.left).toBeLessThan(2);
	expect(box.width).toBeGreaterThan(5);
	expect(box.width).toBeLessThan(60);
});
