import { readFileSync } from "node:fs";
import { expect, test, type Page } from "@playwright/test";
import {
	openEditor,
	recordButton,
	segmentMoshButton,
	selectSegment,
	splitSegmentAt,
	waitForRender,
} from "./app";
import { GREEN, RED } from "./fixtures";

/**
 * Exporting the timeline to a file.
 *
 * The one irreversible thing the app does, and the last place a user finds out
 * something is wrong. Every layer is live here — the WebGL chain, the encoder,
 * the muxer and the audio path — so these are slow, and worth it: nothing
 * below this level can tell you the output was playable.
 */

/** Short on purpose: the export renders every frame through a software
 * rasterizer, so the track's length is most of the runtime here. */
const TRACK_SECONDS = 3;

async function exportAt(page: Page, fps: "15" | "24" = "15") {
	await recordButton(page).click();
	await page.selectOption("#rec-fps", fps);
	const download = page.waitForEvent("download", { timeout: 120_000 });
	await page.getByRole("button", { name: "Start Recording" }).click();
	return download;
}

/** Hand the exported file back to the browser and see if it will play it. */
async function probe(page: Page, path: string) {
	const base64 = readFileSync(path).toString("base64");
	return page.evaluate(async (data) => {
		const bytes = Uint8Array.from(atob(data), (c) => c.charCodeAt(0));
		const url = URL.createObjectURL(new Blob([bytes], { type: "video/webm" }));
		const video = document.createElement("video");
		video.muted = true;
		video.src = url;
		const result = await new Promise<{
			duration: number;
			width: number;
			height: number;
		} | null>((resolve) => {
			video.onloadedmetadata = () =>
				resolve({
					duration: video.duration,
					width: video.videoWidth,
					height: video.videoHeight,
				});
			video.onerror = () => resolve(null);
			setTimeout(() => resolve(null), 15_000);
		});
		URL.revokeObjectURL(url);
		return result;
	}, base64);
}

test.beforeEach(async ({ page }) => {
	page.on("pageerror", (error) => {
		throw new Error(`uncaught page error: ${error.message}`);
	});
});

test("records the timeline to a playable WebM", async ({ page }) => {
	await openEditor(page, {
		sources: [
			["red.png", RED],
			["green.png", GREEN],
		],
		track: { seconds: TRACK_SECONDS },
	});
	await waitForRender(page);

	const download = await exportAt(page);
	const file = await download;
	expect(file.suggestedFilename()).toMatch(/^openmosh-\d+\.webm$/);

	const path = (await file.path())!;
	const bytes = readFileSync(path);
	// EBML magic. A zero-length or half-muxed file still downloads happily.
	expect([...bytes.subarray(0, 4)]).toEqual([0x1a, 0x45, 0xdf, 0xa3]);
	expect(bytes.length).toBeGreaterThan(2000);

	const played = await probe(page, path);
	expect(played, "the exported file wouldn't load as a video").not.toBeNull();
	expect(played!.width).toBeGreaterThan(0);
	expect(played!.height).toBeGreaterThan(0);
});

test("runs as long as the song it was cut to", async ({ page }) => {
	await openEditor(page, {
		sources: [
			["red.png", RED],
			["green.png", GREEN],
		],
		track: { seconds: TRACK_SECONDS },
	});
	await waitForRender(page);

	const file = await await exportAt(page);
	const played = await probe(page, (await file.path())!);
	expect(played).not.toBeNull();
	// A frame or so of slack at each end; what this is really guarding is an
	// export that stops early or runs away.
	expect(played!.duration).toBeGreaterThan(TRACK_SECONDS - 0.5);
	expect(played!.duration).toBeLessThan(TRACK_SECONDS + 1);
});

test("exports a timeline that was cut and moshed", async ({ page }) => {
	// The plain export above renders one clean source end to end. This one has
	// the segment machinery in the loop: a cut, a rolled chain on one side of
	// it, and a source swap at the boundary.
	await openEditor(page, {
		sources: [
			["red.png", RED],
			["green.png", GREEN],
		],
		track: { seconds: TRACK_SECONDS },
	});
	await waitForRender(page);

	await splitSegmentAt(page, 0.5);
	await selectSegment(page, 0);
	await segmentMoshButton(page).click();

	const file = await await exportAt(page);
	const path = (await file.path())!;
	expect([...readFileSync(path).subarray(0, 4)]).toEqual([
		0x1a, 0x45, 0xdf, 0xa3,
	]);

	const played = await probe(page, path);
	expect(played).not.toBeNull();
	expect(played!.duration).toBeGreaterThan(TRACK_SECONDS - 0.5);
});
