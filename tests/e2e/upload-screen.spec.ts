import { expect, test } from "@playwright/test";
import { modeToggle, selectMode } from "./app";

test("switching modes moves neither the tabs nor the panel", async ({
	page,
}) => {
	await page.goto("/");
	const boxes = [];
	for (const mode of ["Single", "Editor", "Slideshow"] as const) {
		await selectMode(page, mode);
		const tabs = (await modeToggle(page).boundingBox())!;
		const panel = (await page.locator(".panel").boundingBox())!;
		boxes.push({ tabsY: tabs.y, panelY: panel.y, height: panel.height });
	}
	expect(boxes[1]).toEqual(boxes[0]);
	expect(boxes[2]).toEqual(boxes[0]);
});
