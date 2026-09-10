import { expect, test } from "@playwright/test";
import {
	canvasStats,
	liveEffectNames,
	liveEffects,
	nearestColor,
	openEditor,
	segmentMoshButton,
	segments,
	selectSegment,
	splitSegmentAt,
	waitForRender,
} from "./app";
import { BLUE, GREEN, RED } from "./fixtures";

/**
 * Editor (sequence) mode, end to end in a real browser.
 *
 * This is the mode everything else is a special case of — a song on a master
 * clock, a pool of sources, segments cutting between them, and a chain per
 * segment. If the timeline can be cut and a segment can be moshed onto the
 * preview, the WebGL path, the source pool and the segment model are all
 * standing up together, which no unit test in this repo can say.
 */

const PALETTE = { red: RED, green: GREEN, blue: BLUE };

test.beforeEach(async ({ page }) => {
	// A component that throws mid-render leaves a stale but plausible preview
	// behind; without this the spec would happily assert against it.
	page.on("pageerror", (error) => {
		throw new Error(`uncaught page error: ${error.message}`);
	});
});

test.describe("opening the editor", () => {
	test("puts the first source on the preview", async ({ page }) => {
		await openEditor(page, {
			sources: [
				["red.png", RED],
				["blue.png", BLUE],
			],
		});

		const stats = await waitForRender(page);
		expect(nearestColor(stats.mean, PALETTE)).toBe("red");
		// A flat source through a clean chain stays flat: nothing is on it yet.
		expect(stats.variance).toBeLessThan(1);
	});

	test("starts as one segment covering the whole song", async ({ page }) => {
		await openEditor(page, { sources: [["red.png", RED]] });
		await waitForRender(page);

		// The source lane partitions the timeline — there is never a gap, so a
		// fresh timeline is exactly one block.
		await expect(segments(page)).toHaveCount(1);
	});

	test("takes every source into the pool", async ({ page }) => {
		await openEditor(page, {
			sources: [
				["red.png", RED],
				["green.png", GREEN],
				["blue.png", BLUE],
			],
		});
		await waitForRender(page);
		await expect(page.getByText("3 SOURCES")).toBeVisible();
	});
});

test.describe("cutting the timeline", () => {
	test("a ctrl+click splits one segment into two", async ({ page }) => {
		await openEditor(page, { sources: [["red.png", RED]] });
		await waitForRender(page);

		await splitSegmentAt(page, 0.25);
		await expect(segments(page)).toHaveCount(2);
	});

	test("the two halves still cover the timeline end to end", async ({
		page,
	}) => {
		await openEditor(page, { sources: [["red.png", RED]] });
		await waitForRender(page);
		const whole = (await segments(page).first().boundingBox())!;

		await splitSegmentAt(page, 0.5);
		const left = (await segments(page).nth(0).boundingBox())!;
		const right = (await segments(page).nth(1).boundingBox())!;

		// Flush against each other, and between them the width of the original.
		// The rects are drawn a pixel apart so the boundary handle reads as a
		// seam, so this is about there being no *gap*, not about touching exactly.
		const seam = Math.abs(right.x - (left.x + left.width));
		expect(seam).toBeLessThanOrEqual(2);
		expect(left.width + right.width).toBeGreaterThan(whole.width - 3);
		expect(left.width + right.width).toBeLessThan(whole.width + 3);
	});

	test("splits again inside a segment that was already cut", async ({
		page,
	}) => {
		await openEditor(page, { sources: [["red.png", RED]] });
		await waitForRender(page);

		await splitSegmentAt(page, 0.5);
		await splitSegmentAt(page, 0.75);
		await expect(segments(page)).toHaveCount(3);
	});
});

test.describe("a segment's chain", () => {
	test("opens empty when the segment is picked", async ({ page }) => {
		await openEditor(page, { sources: [["red.png", RED]] });
		await waitForRender(page);

		await selectSegment(page, 0);
		await expect(page.locator(".chain-count")).toHaveText(/0 live/i);
		await expect(liveEffects(page)).toHaveCount(0);
	});

	test("a mosh switches effects on and changes what's on screen", async ({
		page,
	}) => {
		// The patterned source, not a flat colour: a mosh that happens to roll
		// only spatial effects leaves a flat fill looking exactly as it was, so
		// this asserted nothing about half the rolls and flaked on them.
		await openEditor(page, { sources: [["pattern.png", "pattern"]] });
		const clean = await waitForRender(page);

		await selectSegment(page, 0);
		await segmentMoshButton(page).click();

		await expect(liveEffects(page)).not.toHaveCount(0);
		// The preview is the point: a chain the renderer never picked up would
		// still list effects in the sidebar.
		await expect
			.poll(async () => (await canvasStats(page)).hash, {
				message: "the preview never changed after a mosh",
			})
			.not.toBe(clean.hash);
	});

	test("a second mosh rolls a different chain", async ({ page }) => {
		await openEditor(page, { sources: [["red.png", RED]] });
		await waitForRender(page);

		await selectSegment(page, 0);
		await segmentMoshButton(page).click();
		await expect(liveEffects(page)).not.toHaveCount(0);
		const first = await liveEffectNames(page);

		await segmentMoshButton(page).click();
		await expect
			.poll(async () => (await liveEffectNames(page)).join(), {
				message: "the second mosh rolled the same chain",
			})
			.not.toBe(first.join());
	});

	test("moshes each segment on its own", async ({ page }) => {
		await openEditor(page, { sources: [["red.png", RED]] });
		await waitForRender(page);
		await splitSegmentAt(page, 0.5);

		await selectSegment(page, 0);
		await segmentMoshButton(page).click();
		await expect(liveEffects(page)).not.toHaveCount(0);
		const first = await liveEffectNames(page);

		// The second segment was never moshed, so its chain is still clean.
		await selectSegment(page, 1);
		await expect(liveEffects(page)).toHaveCount(0);

		// And going back doesn't lose the first one's roll.
		await selectSegment(page, 0);
		expect(await liveEffectNames(page)).toEqual(first);
	});

	test("keeps a segment's chain across a re-select", async ({ page }) => {
		await openEditor(page, { sources: [["red.png", RED]] });
		await waitForRender(page);

		await selectSegment(page, 0);
		await segmentMoshButton(page).click();
		await expect(liveEffects(page)).not.toHaveCount(0);
		const rolled = await liveEffectNames(page);

		await page.keyboard.press("Escape");
		await selectSegment(page, 0);
		expect(await liveEffectNames(page)).toEqual(rolled);
	});
});
