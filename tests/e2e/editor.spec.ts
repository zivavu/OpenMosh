import { expect, test, type Page } from "@playwright/test";
import {
	poolCount,
	canvasStats,
	clipMoshButton,
	liveEffectNames,
	liveEffects,
	mediaClips,
	nearestColor,
	openEditor,
	PREVIEW_CANVAS,
	selectClip,
	splitClipAt,
	waitForRender,
} from "./app";
import { BLUE, GREEN, RED } from "./fixtures";

/** Editor (sequence) mode, end to end in a real browser: a song on a master clock, a pool
 * of sources, clips cutting between them, and a chain per clip. */

const PALETTE = { red: RED, green: GREEN, blue: BLUE };

test.beforeEach(async ({ page }) => {
	// A component that throws mid-render leaves a stale but plausible preview to assert against.
	page.on("pageerror", (error) => {
		throw new Error(`uncaught page error: ${error.message}`);
	});
});

test("opening puts the first source on the preview and every file in the pool", async ({
	page,
}) => {
	await openEditor(page, {
		sources: [
			["red.png", RED],
			["green.png", GREEN],
			["blue.png", BLUE],
		],
	});

	const stats = await waitForRender(page);
	expect(nearestColor(stats.mean, PALETTE)).toBe("red");
	// A flat source through a clean chain stays flat: nothing is on it yet.
	expect(stats.variance).toBeLessThan(1);
	await expect(poolCount(page)).toHaveText(/^3\s+sources$/i);
});

test("a ctrl+click cuts a clip in two, and again inside a cut one", async ({
	page,
}) => {
	await openEditor(page, { sources: [["red.png", RED]] });
	await waitForRender(page);
	// The opening layer is one clip over the whole song.
	await expect(mediaClips(page)).toHaveCount(1);
	const whole = (await mediaClips(page).first().boundingBox())!;

	await splitClipAt(page, 0.5);
	await expect(mediaClips(page)).toHaveCount(2);
	const left = (await mediaClips(page).nth(0).boundingBox())!;
	const right = (await mediaClips(page).nth(1).boundingBox())!;
	// Flush against each other, and between them the width of the original. The rects are
	// drawn a pixel apart so the boundary handle reads as a seam, so this is about no gap.
	const seam = Math.abs(right.x - (left.x + left.width));
	expect(seam).toBeLessThanOrEqual(2);
	expect(left.width + right.width).toBeGreaterThan(whole.width - 3);
	expect(left.width + right.width).toBeLessThan(whole.width + 3);

	await splitClipAt(page, 0.75);
	await expect(mediaClips(page)).toHaveCount(3);
});

test.describe("a clip's chain", () => {
	test("a mosh switches effects on and changes what's on screen", async ({
		page,
	}) => {
		// The patterned source, not a flat colour: a mosh that rolls only spatial effects leaves
		// a flat fill looking exactly as it was, so this asserted nothing about half the rolls.
		await openEditor(page, { sources: [["pattern.png", "pattern"]] });
		const clean = await waitForRender(page);

		await selectClip(page, 0);
		await expect(liveEffects(page)).toHaveCount(0);
		await clipMoshButton(page).click();

		await expect(liveEffects(page)).not.toHaveCount(0);
		// The preview is the point: a chain the renderer never picked up still lists effects.
		await expect
			.poll(async () => (await canvasStats(page)).hash, {
				message: "the preview never changed after a mosh",
			})
			.not.toBe(clean.hash);
	});

	test("each clip keeps its own, and a second mosh rolls a new one", async ({
		page,
	}) => {
		await openEditor(page, { sources: [["red.png", RED]] });
		await waitForRender(page);
		await splitClipAt(page, 0.5);

		await selectClip(page, 0);
		await clipMoshButton(page).click();
		await expect(liveEffects(page)).not.toHaveCount(0);
		const first = await liveEffectNames(page);

		await clipMoshButton(page).click();
		await expect
			.poll(async () => (await liveEffectNames(page)).join(), {
				message: "the second mosh rolled the same chain",
			})
			.not.toBe(first.join());
		const rolled = await liveEffectNames(page);

		await selectClip(page, 1);
		await expect(liveEffects(page)).toHaveCount(0);

		await selectClip(page, 0);
		expect(await liveEffectNames(page)).toEqual(rolled);
	});
});

/** Mean red across the preview's left quarter; the pattern's red climbs left to right. */
async function leftQuarterRed(page: Page) {
	return page.evaluate(
		(selector) =>
			new Promise<number>((resolve) => {
				requestAnimationFrame(() => {
					const src = document.querySelector(selector) as HTMLCanvasElement;
					const off = document.createElement("canvas");
					off.width = 64;
					off.height = 64;
					const ctx = off.getContext("2d")!;
					ctx.drawImage(src, 0, 0, 64, 64);
					const px = ctx.getImageData(0, 0, 16, 64).data;
					let r = 0;
					for (let i = 0; i < px.length; i += 4) r += px[i];
					resolve(r / (px.length / 4));
				});
			}),
		PREVIEW_CANVAS,
	);
}

test("dragging a side handle past the far side mirrors the layer", async ({
	page,
}) => {
	await openEditor(page, { sources: [["pattern.png", "pattern"]] });
	await waitForRender(page);
	await selectClip(page, 0);
	const before = await leftQuarterRed(page);

	const outline = (await page.locator(".layer-outline").boundingBox())!;
	const handle = page.locator('.layer-handle[style*="left: 100%; top: 50%"]');
	const grab = (await handle.boundingBox())!;
	const y = grab.y + grab.height / 2;
	// Alt pins the centre, so the right edge dragged to the left one is a mirror in place.
	await page.mouse.move(grab.x + grab.width / 2, y);
	await page.keyboard.down("Alt");
	await page.mouse.down();
	await page.mouse.move(outline.x, y, { steps: 12 });
	await page.mouse.up();
	await page.keyboard.up("Alt");

	await expect
		.poll(() => leftQuarterRed(page), {
			message: "the left side never mirrored",
		})
		.toBeGreaterThan(before + 80);
});
