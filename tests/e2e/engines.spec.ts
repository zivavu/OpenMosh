import { expect, test, type Page } from "@playwright/test";
import { nearestColor, openEditor, openSingle, waitForRender } from "./app";
import { BLUE, GREEN, RED } from "./fixtures";

/** Firefox smoke: the app opens, draws, and nothing throws. The rest of
 * the suite stays on Chromium, which is what OpenMosh is built against. */

function collectErrors(page: Page): string[] {
	const errors: string[] = [];
	page.on("pageerror", (e) => errors.push(e.message));
	return errors;
}

test("single mode draws a dropped image", async ({ page }) => {
	const errors = collectErrors(page);
	await openSingle(page, "red.png", RED);
	const stats = await waitForRender(page);
	expect(nearestColor(stats.mean, { RED, GREEN, BLUE })).toBe("RED");
	expect(errors).toEqual([]);
});

test("the editor opens with a source on its layer", async ({ page }) => {
	const errors = collectErrors(page);
	await openEditor(page, { sources: [["blue.png", BLUE]] });
	const stats = await waitForRender(page);
	expect(nearestColor(stats.mean, { RED, GREEN, BLUE })).toBe("BLUE");
	expect(errors).toEqual([]);
});
