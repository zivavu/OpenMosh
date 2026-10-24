import { expect, test, type Page } from "@playwright/test";
import { openSingle, waitForRender, waitForSaved } from "./app";
import { GREEN, RED } from "./fixtures";

/** The library drawer lists the open mode's saved projects and switches between them. */

test.beforeEach(async ({ page }) => {
	page.on("pageerror", (error) => {
		throw new Error(`uncaught page error: ${error.message}`);
	});
});

async function saveSingle(page: Page) {
	await waitForRender(page);
	await page.getByRole("button", { name: "MOSH", exact: true }).click();
	await waitForSaved(page);
}

test("single mode opens another single project from the drawer", async ({
	page,
}) => {
	await openSingle(page, "red.png", RED);
	await saveSingle(page);
	await openSingle(page, "green.png", GREEN);
	await saveSingle(page);

	await page.getByTitle("Open projects and songs").click();
	const projects = page.locator(".library .project");
	await expect(projects).toHaveCount(2);
	await expect(projects.locator("[aria-current]")).toHaveText(/green\.png/);

	await projects.getByTitle(`Open "red.png"`).click();
	await waitForRender(page);
	await page.getByTitle("Open projects and songs").click();
	await expect(projects.locator("[aria-current]")).toHaveText(/red\.png/);
});
