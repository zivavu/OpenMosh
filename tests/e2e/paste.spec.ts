import { expect, test, type Page } from "@playwright/test";
import {
	nearestColor,
	openEditor,
	poolCount,
	PREVIEW_CANVAS,
	railThumbs,
	waitForRender,
} from "./app";
import { BLUE, GREEN, pngBytes, RED, type Rgb } from "./fixtures";

/** Paste a screenshot onto the page, named as browsers name every pasted image. */
async function pasteImage(page: Page, color: Rgb) {
	const base64 = pngBytes(color).toString("base64");
	await page.evaluate((b64) => {
		const bytes = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
		const data = new DataTransfer();
		data.items.add(new File([bytes], "image.png", { type: "image/png" }));
		document.body.dispatchEvent(
			new ClipboardEvent("paste", { clipboardData: data, bubbles: true }),
		);
	}, base64);
}

test("a pasted image opens on the upload screen", async ({ page }) => {
	await page.goto("/");
	await pasteImage(page, RED);
	await expect(page.locator(PREVIEW_CANVAS)).toBeVisible({ timeout: 30_000 });
	const { mean } = await waitForRender(page);
	expect(nearestColor(mean, { red: RED, green: GREEN, blue: BLUE })).toBe(
		"red",
	);
});

test("a pasted image joins the editor's pool, picked out in the rail", async ({
	page,
}) => {
	await openEditor(page, { sources: [["red.png", RED]] });
	await waitForRender(page);
	await pasteImage(page, GREEN);
	await expect(poolCount(page)).toHaveText(/^2\s+sources$/i);
	const pasted = railThumbs(page).nth(1);
	await expect(pasted).toHaveAttribute("title", /pasted-\d+\.png/);
	await expect(pasted).toHaveClass(/playing/);
	await expect(railThumbs(page).nth(0)).not.toHaveClass(/playing/);
});
