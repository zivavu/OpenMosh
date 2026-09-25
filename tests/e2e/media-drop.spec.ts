import { expect, test } from "@playwright/test";
import {
	addMediaLayer,
	canvasStats,
	clipSpanFraction,
	dragAwayFromLanes,
	dragSourceToLane,
	dropHeldSource,
	mediaClips,
	mediaDropGhost,
	nearestColor,
	openEditor,
	railThumbs,
	waitForRender,
} from "./app";
import { BLUE, GREEN, RED } from "./fixtures";

/** Dragging media out of the pool and onto a layer lane. The gesture has two readings
 * and the lane picks one mid-drag: over a clip it retargets, over empty space it cuts. */

test.beforeEach(async ({ page }) => {
	page.on("pageerror", (error) => {
		throw new Error(`uncaught page error: ${error.message}`);
	});
});

const PALETTE = { red: RED, green: GREEN, blue: BLUE };

const SOURCES: [string, typeof RED][] = [
	["red.png", RED],
	["blue.png", BLUE],
	["green.png", GREEN],
];

/** The lane the specs drop onto: the empty one added over the opening layer. */
const LAYER = 1;

/** A dropped still lays down 20 seconds, so the song has to be longer than that for a
 * drop to land where it was aimed rather than back up to fit the lane. */
const TRACK_SECONDS = 60;

async function openLayers(page: Parameters<typeof openEditor>[0]) {
	await openEditor(page, {
		sources: SOURCES,
		track: { seconds: TRACK_SECONDS },
	});
	await waitForRender(page);
	await addMediaLayer(page);
	// Every drop below leans on the new lane starting empty.
	await expect(mediaClips(page, LAYER)).toHaveCount(0);
}

test.describe("dropping onto empty space", () => {
	test("shows a ghost, then cuts the dropped media exactly where it promised", async ({
		page,
	}) => {
		await openLayers(page);

		await dragSourceToLane(page, {
			thumb: 2,
			lane: LAYER,
			fraction: 0.3,
			hold: true,
		});
		// The whole point of the placeholder: the span is visible while there is time to move it.
		await expect(mediaDropGhost(page, LAYER)).toBeVisible();
		await expect(mediaClips(page, LAYER)).toHaveCount(0);
		const ghost = await clipSpanFraction(
			page,
			mediaDropGhost(page, LAYER),
			LAYER,
		);

		await dropHeldSource(page);
		await expect(mediaDropGhost(page, LAYER)).toHaveCount(0);
		await expect(mediaClips(page, LAYER)).toHaveCount(1);
		const clip = mediaClips(page, LAYER).first();
		await expect(clip).toContainText("green.png");
		const span = await clipSpanFraction(page, clip, LAYER);
		// A preview that lies about where the media lands is worse than none.
		expect(span.start).toBeCloseTo(ghost.start, 2);
		expect(span.end).toBeCloseTo(ghost.end, 2);
		expect(span.start).toBeGreaterThan(0.25);
		expect(span.start).toBeLessThan(0.35);
		// A still has no length of its own, so the drop gives it the 20-second default.
		expect(span.end - span.start).toBeCloseTo(20 / TRACK_SECONDS, 2);
	});

	test("takes the ghost away when the drag leaves the lane", async ({
		page,
	}) => {
		await openLayers(page);

		await dragSourceToLane(page, {
			thumb: 1,
			lane: LAYER,
			fraction: 0.4,
			hold: true,
		});
		await expect(mediaDropGhost(page, LAYER)).toBeVisible();

		await dragAwayFromLanes(page);
		await expect(mediaDropGhost(page, LAYER)).toHaveCount(0);

		await dropHeldSource(page);
		await expect(mediaClips(page, LAYER)).toHaveCount(0);
	});

	test("a second drop lands beside the first without overlapping it", async ({
		page,
	}) => {
		await openLayers(page);

		await dragSourceToLane(page, { thumb: 1, lane: LAYER, fraction: 0.2 });
		await expect(mediaClips(page, LAYER)).toHaveCount(1);
		await dragSourceToLane(page, { thumb: 2, lane: LAYER, fraction: 0.7 });
		await expect(mediaClips(page, LAYER)).toHaveCount(2);

		const first = await clipSpanFraction(
			page,
			mediaClips(page, LAYER).nth(0),
			LAYER,
		);
		const second = await clipSpanFraction(
			page,
			mediaClips(page, LAYER).nth(1),
			LAYER,
		);
		const [left, right] =
			first.start <= second.start ? [first, second] : [second, first];
		expect(left.end).toBeLessThanOrEqual(right.start + 0.01);
	});
});

test("dropping onto a clip retargets it instead of cutting a new one", async ({
	page,
}) => {
	await openLayers(page);
	await dragSourceToLane(page, { thumb: 1, lane: LAYER, fraction: 0.3 });
	await expect(mediaClips(page, LAYER)).toHaveCount(1);
	const span = await clipSpanFraction(
		page,
		mediaClips(page, LAYER).first(),
		LAYER,
	);

	await dragSourceToLane(page, {
		thumb: 2,
		lane: LAYER,
		fraction: (span.start + span.end) / 2,
		hold: true,
	});
	// No ghost, since nothing new is being made; the clip under the cursor lights instead.
	await expect(mediaDropGhost(page, LAYER)).toHaveCount(0);
	await expect(mediaClips(page, LAYER).first()).toHaveClass(/drop-target/);

	await dropHeldSource(page);
	await expect(mediaClips(page, LAYER)).toHaveCount(1);
	await expect(mediaClips(page, LAYER).first()).toContainText("green.png");
});

test("dropping on the playhead lands under it and shows on the preview", async ({
	page,
}) => {
	await openLayers(page);
	// The opening layer shows the first source (red); the drop must take it to blue.
	await expect
		.poll(async () => nearestColor((await canvasStats(page)).mean, PALETTE))
		.toBe("red");

	// The start marker's grab handle is drawn over the lanes, so a drop at the head used
	// to hit the handle and do nothing, at the one spot media most naturally goes.
	await dragSourceToLane(page, { thumb: 1, lane: LAYER, fraction: 0 });

	await expect(mediaClips(page, LAYER)).toHaveCount(1);
	const span = await clipSpanFraction(
		page,
		mediaClips(page, LAYER).first(),
		LAYER,
	);
	expect(span.start).toBeLessThan(0.01);
	await expect
		.poll(async () => nearestColor((await canvasStats(page)).mean, PALETTE), {
			message: "preview never took the dropped layer",
		})
		.toBe("blue");
});

test("dragging a rail thumb onto another reorders the pool", async ({
	page,
}) => {
	await openLayers(page);
	const names = async () => railThumbs(page).allInnerTexts();
	const before = await names();

	const from = (await railThumbs(page).nth(0).boundingBox())!;
	const to = (await railThumbs(page).nth(2).boundingBox())!;
	await page.mouse.move(from.x + from.width / 2, from.y + from.height / 2);
	await page.mouse.down();
	await page.mouse.move(from.x + from.width / 2, from.y - 10, { steps: 4 });
	await page.mouse.move(to.x + to.width / 2, to.y + to.height / 2, {
		steps: 12,
	});
	await page.mouse.up();

	// The same dragstart feeds both drops; a reorder must not become a lane drop.
	await expect.poll(names).not.toEqual(before);
});
