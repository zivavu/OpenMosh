import { expect, test } from "@playwright/test";
import { nearestColor, openEditor, poolCount, waitForRender } from "./app";
import { BLUE, GREEN, RED } from "./fixtures";

/** Some browsers (private windows, a full disk) refuse to store files in IndexedDB.
 * What was opened still has to show, and the top bar has to admit it isn't saved. */
test.beforeEach(async ({ page }) => {
	await page.addInitScript(() => {
		const holdsBlob = (value: unknown, depth = 0): boolean => {
			if (value instanceof Blob) return true;
			if (depth > 3 || !value || typeof value !== "object") return false;
			return Object.values(value).some((v) => holdsBlob(v, depth + 1));
		};
		for (const method of ["put", "add"] as const) {
			const original = IDBObjectStore.prototype[method];
			IDBObjectStore.prototype[method] = function (value, key) {
				if (holdsBlob(value)) {
					(window as { blockedWrites?: number }).blockedWrites =
						((window as { blockedWrites?: number }).blockedWrites ?? 0) + 1;
					throw new DOMException(
						"Error preparing Blob/File data to be stored in object store",
						"UnknownError",
					);
				}
				return original.call(this, value, key);
			};
		}
	});
});

test("the editor shows its media and says it couldn't save it", async ({
	page,
}) => {
	await openEditor(page, { sources: [["blue.png", BLUE]] });
	await expect(poolCount(page)).toContainText("1");
	const stats = await waitForRender(page);
	expect(nearestColor(stats.mean, { RED, GREEN, BLUE })).toBe("BLUE");
	// The stub has to have refused something, or this proves nothing.
	await expect
		.poll(() =>
			page.evaluate(() => (window as { blockedWrites?: number }).blockedWrites),
		)
		.toBeGreaterThan(0);
	// Saying "Saved" would promise media that a reload won't bring back.
	await expect(page.locator(".save-indicator")).toContainText("Save failed");
});
