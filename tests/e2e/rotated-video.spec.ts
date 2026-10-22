import { expect, test, type Page } from "@playwright/test";
import { PREVIEW_CANVAS, selectMode, waitForRender } from "./app";

/** Phones store portrait clips sideways with rotation metadata. Both decode paths
 * have to hand the frames over upright, at the upright size. */

const load = (page: Page) => page.goto("/");

/** The rotated clip's bytes, red on top and blue below once upright. */
async function rotatedClip(page: Page): Promise<Buffer> {
	const bytes = await page.evaluate(async () => {
		const path = "/src/lib/testing/rotated-video.ts";
		const { rotatedMp4 } = await import(/* @vite-ignore */ path);
		return rotatedMp4("rgb(220,30,30)", "rgb(40,70,230)");
	});
	return Buffer.from(bytes);
}

test("the slideshow probe and sampler read a rotated clip upright", async ({
	page,
}) => {
	await load(page);
	const result = await page.evaluate(
		async (bytes) => {
			const importPath = (p: string) => import(/* @vite-ignore */ p);
			const { probeSlideVideo, SlideVideoSampler } = await importPath(
				"/src/lib/slideshow/video-sampler.ts",
			);
			const file = new File([new Uint8Array(bytes)], "portrait.mp4", {
				type: "video/mp4",
			});
			const probe = await probeSlideVideo(file);
			const sampler = await SlideVideoSampler.create(file);
			const frame: VideoFrame | null = await sampler.at(0.2);
			const canvas = new OffscreenCanvas(
				frame!.displayWidth,
				frame!.displayHeight,
			);
			const ctx = canvas.getContext("2d")!;
			ctx.drawImage(frame!, 0, 0);
			const px = (y: number) =>
				[...ctx.getImageData(canvas.width / 2, y, 1, 1).data].slice(0, 3);
			const out = {
				probe: probe && { width: probe.width, height: probe.height },
				frame: { width: canvas.width, height: canvas.height },
				top: px(canvas.height * 0.25),
				bottom: px(canvas.height * 0.75),
			};
			frame!.close();
			sampler.dispose();
			return out;
		},
		[...(await rotatedClip(page))],
	);
	expect(result.probe).toEqual({ width: 64, height: 128 });
	expect(result.frame).toEqual({ width: 64, height: 128 });
	expect(result.top[0]).toBeGreaterThan(result.top[2]);
	expect(result.bottom[2]).toBeGreaterThan(result.bottom[0]);
});

test("the editor takes a rotated clip and shows it upright", async ({
	page,
}) => {
	await load(page);
	const clip = await rotatedClip(page);
	await selectMode(page, "Editor");
	await page.locator('input[type="file"][accept*="image/png"]').setInputFiles({
		name: "portrait.mp4",
		mimeType: "video/mp4",
		buffer: clip,
	});
	await expect(page.locator(PREVIEW_CANVAS)).toBeVisible({ timeout: 30_000 });
	await waitForRender(page);
	const rows = await page.evaluate(
		(selector) =>
			new Promise<number[][]>((resolve) =>
				requestAnimationFrame(() => {
					const source = document.querySelector(selector) as HTMLCanvasElement;
					const off = document.createElement("canvas");
					off.width = 8;
					off.height = 8;
					const ctx = off.getContext("2d")!;
					ctx.drawImage(source, 0, 0, 8, 8);
					const at = (y: number) => [...ctx.getImageData(4, y, 1, 1).data];
					resolve([at(2), at(6)]);
				}),
			),
		PREVIEW_CANVAS,
	);
	expect(rows[0][0]).toBeGreaterThan(rows[0][2]);
	expect(rows[1][2]).toBeGreaterThan(rows[1][0]);
});
