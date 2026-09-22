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

async function openLayers(page: Parameters<typeof openEditor>[0]) {
	await openEditor(page, { sources: SOURCES });
	await waitForRender(page);
	await addMediaLayer(page);
}

test.describe("a new layer", () => {
	test("arrives empty, so the whole lane is space to drop into", async ({
		page,
	}) => {
		await openLayers(page);

		// Worth pinning: every drop-to-create test below leans on the lane starting clear.
		await expect(mediaClips(page, LAYER)).toHaveCount(0);
	});
});

test.describe("dropping onto empty space", () => {
	test("cuts a new clip where the drop landed", async ({ page }) => {
		await openLayers(page);

		await dragSourceToLane(page, { thumb: 1, lane: LAYER, fraction: 0.3 });

		await expect(mediaClips(page, LAYER)).toHaveCount(1);
		const span = await clipSpanFraction(
			page,
			mediaClips(page, LAYER).first(),
			LAYER,
		);
		expect(span.start).toBeGreaterThan(0.25);
		expect(span.start).toBeLessThan(0.35);
	});

	test("shows a ghost of the clip before the drop", async ({ page }) => {
		await openLayers(page);

		await dragSourceToLane(page, {
			thumb: 1,
			lane: LAYER,
			fraction: 0.4,
			hold: true,
		});

		// The whole point of the placeholder: the span is visible while there is time to move it.
		await expect(mediaDropGhost(page, LAYER)).toBeVisible();
		await expect(mediaClips(page, LAYER)).toHaveCount(0);

		await dropHeldSource(page);
		await expect(mediaDropGhost(page, LAYER)).toHaveCount(0);
		await expect(mediaClips(page, LAYER)).toHaveCount(1);
	});

	test("puts the clip exactly where the ghost promised", async ({ page }) => {
		await openLayers(page);

		await dragSourceToLane(page, {
			thumb: 1,
			lane: LAYER,
			fraction: 0.45,
			hold: true,
		});
		const ghost = await clipSpanFraction(
			page,
			mediaDropGhost(page, LAYER),
			LAYER,
		);
		await dropHeldSource(page);

		await expect(mediaClips(page, LAYER)).toHaveCount(1);
		const clip = await clipSpanFraction(
			page,
			mediaClips(page, LAYER).first(),
			LAYER,
		);
		// A preview that lies about where the media lands is worse than none.
		expect(clip.start).toBeCloseTo(ghost.start, 2);
		expect(clip.end).toBeCloseTo(ghost.end, 2);
	});

	test("names the media that was dropped, not the lane's own", async ({
		page,
	}) => {
		await openLayers(page);

		await dragSourceToLane(page, { thumb: 2, lane: LAYER, fraction: 0.3 });

		await expect(mediaClips(page, LAYER).first()).toContainText("green.png");
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

test.describe("dropping onto a clip", () => {
	/** Lay one clip down and return a point inside it, as a lane fraction. */
	async function layClip(page: Parameters<typeof openEditor>[0]) {
		await dragSourceToLane(page, { thumb: 1, lane: LAYER, fraction: 0.3 });
		await expect(mediaClips(page, LAYER)).toHaveCount(1);
		const span = await clipSpanFraction(
			page,
			mediaClips(page, LAYER).first(),
			LAYER,
		);
		return (span.start + span.end) / 2;
	}

	test("retargets that clip instead of cutting a new one", async ({ page }) => {
		await openLayers(page);
		const onClip = await layClip(page);

		await dragSourceToLane(page, { thumb: 2, lane: LAYER, fraction: onClip });

		await expect(mediaClips(page, LAYER)).toHaveCount(1);
		await expect(mediaClips(page, LAYER).first()).toContainText("green.png");
	});

	test("shows no ghost — nothing new is being made", async ({ page }) => {
		await openLayers(page);
		const onClip = await layClip(page);

		await dragSourceToLane(page, {
			thumb: 2,
			lane: LAYER,
			fraction: onClip,
			hold: true,
		});

		await expect(mediaDropGhost(page, LAYER)).toHaveCount(0);
		// The clip under the cursor lights instead, so the gesture still reads.
		await expect(mediaClips(page, LAYER).first()).toHaveClass(/drop-target/);
		await dropHeldSource(page);
	});
});

test.describe("dropping on the playhead", () => {
	test("lands under it rather than on its grab handle", async ({ page }) => {
		await openLayers(page);

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
	});
});

test.describe("what the preview draws", () => {
	test("shows the dropped media on the layer", async ({ page }) => {
		await openLayers(page);
		// The opening layer shows the first source (red); the drop must take it to blue.
		await expect
			.poll(async () => nearestColor((await canvasStats(page)).mean, PALETTE))
			.toBe("red");

		// At the head, where the playhead sits, so the clip covers what is drawn.
		await dragSourceToLane(page, { thumb: 1, lane: LAYER, fraction: 0 });
		await expect(mediaClips(page, LAYER)).toHaveCount(1);

		await expect
			.poll(async () => nearestColor((await canvasStats(page)).mean, PALETTE), {
				message: "preview never took the dropped layer",
			})
			.toBe("blue");
	});
});

test.describe("the rail's own gesture still works", () => {
	test("dragging a thumb onto another thumb reorders the pool", async ({
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
});
