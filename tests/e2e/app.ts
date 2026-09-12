import { expect, type Locator, type Page } from "@playwright/test";
import {
	imageFile,
	patternImageFile,
	trackFile,
	type Rgb,
	type WavOptions,
} from "./fixtures";

/**
 * The moves every editor spec makes, in the app's own vocabulary.
 *
 * Selectors live here and nowhere else: the editor is one 5000-line component
 * whose markup moves constantly, and a spec that reaches into it directly goes
 * stale the next time a button is restyled.
 */

export const PREVIEW_CANVAS = 'canvas[aria-label="Effect preview canvas"]';

/** A downscale big enough to tell a red frame from a blue one, small enough to
 * ship over the CDP bridge on every poll. */
const SAMPLE = 32;

export interface CanvasStats {
	mean: Rgb;
	/** Spread across the sampled pixels. Zero means a flat fill. */
	variance: number;
	/** Quantised colour count — a rough stand-in for "how much is going on". */
	distinctColors: number;
	/** Cheap content hash, for asking whether two frames differ at all. */
	hash: string;
	blank: boolean;
}

/**
 * Sample what the preview is actually showing.
 *
 * The read happens inside a rAF callback so it lands after the app's own draw
 * for that frame: a WebGL canvas without `preserveDrawingBuffer` is only
 * guaranteed to hold its content until the frame is composited, and reading
 * from outside the loop is how you get an empty buffer back.
 */
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

/** Which of the fixture colours the preview is closest to. */
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
	/**
	 * Pool sources, as [name, colour] pairs. `"pattern"` in place of a colour
	 * gives that source the detailed test image instead of a flat fill — which
	 * a spec needs whenever it asserts that the preview *changed*, since a flat
	 * source comes out of a spatial effect looking exactly the same.
	 */
	sources: [string, Rgb | "pattern"][];
	track?: WavOptions & { name?: string };
}

/**
 * Take the upload screen through to the segment editor.
 *
 * The song goes in first on purpose: the upload screen holds media back until
 * a track arrives and launches the moment it does, so loading in this order
 * makes the transition happen at one known point instead of racing.
 */
export async function openEditor(
	page: Page,
	{ sources, track = {} }: OpenEditorOptions,
): Promise<void> {
	await page.goto("/");
	await page.getByRole("button", { name: "Editor", exact: true }).click();

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
	return page.getByRole("button", { name: "RECORD" });
}

/** The source lane, where segments are made and picked. */
export function moshLane(page: Page): Locator {
	return page.locator(".step-svg").first();
}

export function segments(page: Page): Locator {
	return page.locator("rect.seg");
}

/**
 * The chain lists every effect the app has; only the enabled ones render. The
 * panel's own "N live" readout counts these, so they're what a spec means when
 * it says a segment has effects on it.
 */
export function liveEffects(page: Page): Locator {
	return page.locator(".effect-item.enabled");
}

/** Which effects a segment's chain has switched on, by name and in order. */
export async function liveEffectNames(page: Page): Promise<string[]> {
	return liveEffects(page)
		.locator(".name")
		.allInnerTexts()
		.then((names) => names.map((n) => n.trim()));
}

/** Cut a new segment boundary at `fraction` along the source lane. */
export async function splitSegmentAt(
	page: Page,
	fraction: number,
): Promise<void> {
	const lane = moshLane(page);
	const box = (await lane.boundingBox())!;
	await lane.click({
		modifiers: ["Control"],
		position: { x: box.width * fraction, y: box.height / 2 },
	});
}

/** Open a segment's chain in the sidebar. */
export async function selectSegment(page: Page, index: number): Promise<void> {
	// force: the rects are inside an SVG that draws its own hit targets over
	// them, and Playwright's actionability check lands on the wrong one.
	await segments(page).nth(index).click({ force: true });
	await expect(page.locator(".chain-count")).toBeVisible();
}

/** Roll a random chain onto the selected segment. */
export function segmentMoshButton(page: Page): Locator {
	return page.getByTitle("Random mosh for this segment");
}

/**
 * Take the upload screen through to single mode with one image. No mode
 * button is pressed: single is the default, and on a touch device it is the
 * only mode there is.
 */
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

/** The upload screen's Single / Editor / Slideshow pill. */
export function modeToggle(page: Page): Locator {
	return page.locator(".mode-toggle");
}

/** Drag handle of the bottom sheet the sidebar becomes on a phone. */
export function sheetHandle(page: Page): Locator {
	return page.getByRole("button", { name: "Toggle panel" });
}

export function sheetTab(page: Page, name: "Settings" | "Effects"): Locator {
	return page.locator(".tab-btn", { hasText: name });
}

/** Whatever the active sheet tab is showing. */
export function sheetContent(page: Page): Locator {
	return page.locator(".tab-content");
}

/** Every effect the chain lists, live or not. */
export function effectItems(within: Page | Locator): Locator {
	return within.locator(".effect-item");
}

/** The row of controls under the preview: library, mosh group, save. */
export function actionBar(page: Page): Locator {
	return page.locator(".action-bar");
}

export function layerButtons(page: Page): Locator {
	return page.getByTitle(/^(Text timeline|Media layers):/);
}

/** The toolbar under the stack for the selected segment(s). */
export function segmentBar(page: Page): Locator {
	return page.locator(".seg-bar");
}

/** The stack of lanes under the preview, once a clock is driving it. */
export function timelineStack(page: Page): Locator {
	return page.locator(".tl-stack");
}

/** The caption column beside every lane. */
export function laneGutters(page: Page): Locator {
	return page.locator(".tl-stack .tl-gutter");
}
