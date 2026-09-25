import { expect, type Locator, type Page } from "@playwright/test";
import {
	imageFile,
	patternImageFile,
	trackFile,
	type Rgb,
	type WavOptions,
} from "./fixtures";

/** The moves every editor spec makes. Selectors live here and nowhere else: the
 * editor is one 5000-line component whose markup moves constantly. */

export const PREVIEW_CANVAS = 'canvas[aria-label="Effect preview canvas"]';

/** Downscale big enough to tell a red frame from a blue one, small enough to ship per poll. */
const SAMPLE = 32;

export interface CanvasStats {
	mean: Rgb;
	/** Spread across the sampled pixels. Zero means a flat fill. */
	variance: number;
	/** Quantised colour count: a rough stand-in for "how much is going on". */
	distinctColors: number;
	/** Cheap content hash, for asking whether two frames differ at all. */
	hash: string;
	blank: boolean;
}

/** Sample what the preview is showing. The read happens inside a rAF callback so it
 * lands after the app's own draw; outside the loop you get an empty buffer back. */
export async function canvasStats(page: Page): Promise<CanvasStats> {
	return page.evaluate(
		async ([selector, sample]) => {
			const source = document.querySelector(
				selector,
			) as HTMLCanvasElement | null;
			if (!source) throw new Error(`no preview canvas matched ${selector}`);

			const pixels = await new Promise<Uint8ClampedArray>((resolve) => {
				requestAnimationFrame(() => {
					const off = document.createElement("canvas");
					off.width = sample;
					off.height = sample;
					const ctx = off.getContext("2d", { willReadFrequently: true })!;
					ctx.drawImage(source, 0, 0, sample, sample);
					resolve(ctx.getImageData(0, 0, sample, sample).data);
				});
			});

			let rs = 0;
			let gs = 0;
			let bs = 0;
			const count = pixels.length / 4;
			const colors = new Set<number>();
			for (let i = 0; i < pixels.length; i += 4) {
				rs += pixels[i];
				gs += pixels[i + 1];
				bs += pixels[i + 2];
				colors.add(
					((pixels[i] >> 4) << 8) |
						((pixels[i + 1] >> 4) << 4) |
						(pixels[i + 2] >> 4),
				);
			}
			const mean = { r: rs / count, g: gs / count, b: bs / count };

			let spread = 0;
			for (let i = 0; i < pixels.length; i += 4) {
				spread +=
					(pixels[i] - mean.r) ** 2 +
					(pixels[i + 1] - mean.g) ** 2 +
					(pixels[i + 2] - mean.b) ** 2;
			}

			// FNV-1a over the sampled bytes: only ever compared for equality.
			let hash = 0x811c9dc5;
			for (let i = 0; i < pixels.length; i += 4) {
				for (let c = 0; c < 3; c++) {
					hash ^= pixels[i + c];
					hash = Math.imul(hash, 0x01000193) >>> 0;
				}
			}

			return {
				mean,
				variance: spread / (count * 3),
				distinctColors: colors.size,
				hash: hash.toString(16),
				// Fully black *and* flat: an unrendered canvas, not a dark frame.
				blank: mean.r + mean.g + mean.b < 3 && spread === 0,
			};
		},
		[PREVIEW_CANVAS, SAMPLE] as const,
	);
}

/** Wait until the preview has drawn something other than an empty buffer. */
export async function waitForRender(page: Page): Promise<CanvasStats> {
	let last: CanvasStats | null = null;
	await expect
		.poll(
			async () => {
				last = await canvasStats(page);
				return last.blank;
			},
			{ message: "preview canvas never drew a frame", timeout: 30_000 },
		)
		.toBe(false);
	return last!;
}

export function nearestColor(mean: Rgb, palette: Record<string, Rgb>): string {
	let best = "";
	let bestDistance = Infinity;
	for (const [name, color] of Object.entries(palette)) {
		const d =
			(mean.r - color.r) ** 2 +
			(mean.g - color.g) ** 2 +
			(mean.b - color.b) ** 2;
		if (d < bestDistance) {
			bestDistance = d;
			best = name;
		}
	}
	return best;
}

export interface OpenEditorOptions {
	/** Pool sources, as [name, colour] pairs. `"pattern"` gives that source the detailed
	 * test image instead of a flat fill, which a spec needs to assert the preview changed. */
	sources: [string, Rgb | "pattern"][];
	track?: WavOptions & { name?: string };
}

/** Take the upload screen through to the editor. The song goes in first on
 * purpose: the upload screen holds media back until a track arrives and launches then. */
export async function openEditor(
	page: Page,
	{ sources, track = {} }: OpenEditorOptions,
): Promise<void> {
	await page.goto("/");
	await selectMode(page, "Editor");

	const { name = "track.wav", ...wav } = track;
	await page
		.locator('input[type="file"][accept*="audio"]')
		.setInputFiles(trackFile(name, wav));
	await page
		.locator('input[type="file"]:not([accept*="audio"])')
		.setInputFiles(
			sources.map(([file, color]) =>
				color === "pattern" ? patternImageFile(file) : imageFile(file, color),
			),
		);

	await expect(page.locator(PREVIEW_CANVAS)).toBeVisible({ timeout: 30_000 });
}

export function recordButton(page: Page): Locator {
	// Exact and case-sensitive: the pool's webcam take button is also a "Record".
	return page.getByRole("button", { name: "RECORD", exact: true });
}

/** The chain lists every effect the app has; only the enabled ones render. The panel's
 * "N live" readout counts these, so this is what a spec means by effects on a clip. */
export function liveEffects(page: Page): Locator {
	return page.locator(".effect-item.enabled");
}

export async function liveEffectNames(page: Page): Promise<string[]> {
	return liveEffects(page)
		.locator(".name")
		.allInnerTexts()
		.then((names) => names.map((n) => n.trim()));
}

/** Ctrl+click the opening layer to cut its clip. */
export async function splitClipAt(page: Page, fraction: number): Promise<void> {
	const lane = mediaLaneTrack(page, 0);
	const box = (await lane.boundingBox())!;
	await lane.click({
		modifiers: ["Control"],
		position: { x: box.width * fraction, y: box.height / 2 },
	});
}

export async function selectClip(page: Page, index: number): Promise<void> {
	await mediaClips(page).nth(index).click();
	await expect(page.locator(".chain-count")).toBeVisible();
}

/** Roll a random chain onto the selected clip. */
export function clipMoshButton(page: Page): Locator {
	return page.getByTitle("Random mosh for this clip");
}

/** Take the upload screen through to single mode with one image. No mode button is
 * pressed: single is the default, and on a touch device it is the only mode there is. */
export async function openSingle(
	page: Page,
	file: string,
	color: Rgb | "pattern",
	{ track }: { track?: WavOptions & { name?: string } } = {},
): Promise<void> {
	await page.goto("/");
	if (track) {
		const { name = "track.wav", ...wav } = track;
		await page
			.locator('input[type="file"][accept*="audio"]')
			.setInputFiles(trackFile(name, wav));
	}
	await page
		.locator('input[type="file"]:not([accept*="audio"])')
		.setInputFiles(
			color === "pattern" ? patternImageFile(file) : imageFile(file, color),
		);
	await expect(page.locator(PREVIEW_CANVAS)).toBeVisible({ timeout: 30_000 });
}

export function modeToggle(page: Page): Locator {
	return page.locator(".mode-toggle");
}

/** Pick a mode. The tabs are numbered ("2 Editor"), so match the label's tail. */
export async function selectMode(
	page: Page,
	mode: "Single" | "Editor" | "Slideshow",
): Promise<void> {
	await modeToggle(page)
		.getByRole("tab", { name: new RegExp(`${mode}$`) })
		.click();
}

/** Drag handle of the bottom sheet the sidebar becomes on a phone. */
export function sheetHandle(page: Page): Locator {
	return page.getByRole("button", { name: "Toggle panel" });
}

/** A tab of that sheet, by the label it carries: the settings tab is "Mosh" in the
 * editor and "Settings" in the slideshow; the chain tab is "Chain" in both. */
export function sheetTab(
	page: Page,
	name: "Mosh" | "Settings" | "Chain",
): Locator {
	return page.locator(".tab-btn", { hasText: name });
}

export function sheetContent(page: Page): Locator {
	return page.locator(".tab-content");
}

export function effectItems(within: Page | Locator): Locator {
	return within.locator(".effect-item");
}

/** The row of controls under the preview: library, mosh group, save. */
export function actionBar(page: Page): Locator {
	return page.locator(".action-bar");
}

/** The editor's layer controls: the text timeline toggle and the add-layer buttons. */
export function layerButtons(page: Page): Locator {
	return page.getByTitle(
		/^(Text timeline:|Add a layer of images or videos|Add a lane of extra effects)/,
	);
}

export function chainBar(page: Page): Locator {
	return page.locator(".chain-bar");
}

/** The stack of lanes under the preview, once a clock is driving it. */
export function timelineStack(page: Page): Locator {
	return page.locator(".tl-stack");
}

export function laneGutters(page: Page): Locator {
	return page.locator(".tl-stack .tl-gutter");
}

// Media and text rows differ only by `data-lane-kind`, so everything here goes through it.

/** Thumbs in the media pool rail under the preview; what a drag starts from. */
export function railThumbs(page: Page): Locator {
	return page.locator(".rail-item");
}

function mediaLanes(page: Page): Locator {
	return page.locator('.tl-row[data-lane-kind="media"]');
}

/** A lane's clip track: the drop target, and the box every x is measured in. */
function mediaLaneTrack(page: Page, lane = 0): Locator {
	return mediaLanes(page).nth(lane).locator(".lane-track");
}

/** The clips actually on a lane, never the drop ghost. */
export function mediaClips(page: Page, lane = 0): Locator {
	return mediaLaneTrack(page, lane).locator(".clip:not(.ghost)");
}

/** The placeholder shown mid-drag, where a drop would cut its clip. */
export function mediaDropGhost(page: Page, lane = 0): Locator {
	return mediaLaneTrack(page, lane).locator(".clip.ghost");
}

export async function addMediaLayer(page: Page): Promise<void> {
	await expect(mediaLanes(page)).toHaveCount(1);
	await page.getByRole("button", { name: "Media layer" }).click();
	await expect(mediaLanes(page)).toHaveCount(2);
}

async function laneX(
	page: Page,
	lane: number,
	fraction: number,
): Promise<{ x: number; y: number }> {
	const box = (await mediaLaneTrack(page, lane).boundingBox())!;
	return { x: box.x + box.width * fraction, y: box.y + box.height / 2 };
}

export interface SourceDragOptions {
	/** Index into the rail. */
	thumb: number;
	lane?: number;
	/** Where across the lane to hold the cursor, 0-1. */
	fraction: number;
	/** Leave the drag in the air, for asserting on the ghost. */
	hold?: boolean;
}

/** Drag a rail thumb onto a media lane with real mouse input. Chromium turns a
 * press-move-release over a `draggable` into a native HTML5 drag, not synthetic events. */
export async function dragSourceToLane(
	page: Page,
	{ thumb, lane = 0, fraction, hold = false }: SourceDragOptions,
): Promise<void> {
	const from = (await railThumbs(page).nth(thumb).boundingBox())!;
	const to = await laneX(page, lane, fraction);
	await page.mouse.move(from.x + from.width / 2, from.y + from.height / 2);
	await page.mouse.down();
	// Clear the drag threshold first: one jump to the target can land before a drag starts.
	await page.mouse.move(from.x + from.width / 2, from.y - 20, { steps: 4 });
	await page.mouse.move(to.x, to.y, { steps: 12 });
	// A dragover at rest, so the last one the lane sees is the one being asserted.
	await page.mouse.move(to.x, to.y);
	if (hold) return;
	await page.mouse.up();
}

export async function dropHeldSource(page: Page): Promise<void> {
	await page.mouse.up();
}

export async function dragAwayFromLanes(page: Page): Promise<void> {
	const box = (await page.locator(PREVIEW_CANVAS).boundingBox())!;
	await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2, {
		steps: 8,
	});
}

/** Where a clip (or the ghost) sits across its lane, as 0-1 fractions. */
export async function clipSpanFraction(
	page: Page,
	clip: Locator,
	lane = 0,
): Promise<{ start: number; end: number }> {
	const track = (await mediaLaneTrack(page, lane).boundingBox())!;
	const box = (await clip.boundingBox())!;
	return {
		start: (box.x - track.x) / track.width,
		end: (box.x + box.width - track.x) / track.width,
	};
}
