import { expect, test as base, type Page } from "@playwright/test";
import { patternPngBase64, pngBytes, RED } from "./fixtures";

/**
 * How the renderer combines things, rather than what any one effect looks like.
 *
 * `rendering.spec.ts` runs every effect on its own, which is most of the
 * shader surface and none of the composition around it: chain order, the
 * stacked fx lanes, and the media layers that get composited into the chain.
 * That composition has real branches nothing covers — `livePostLayers` drops
 * lanes that can't contribute, and `allFullWeight` picks between concatenating
 * every lane into one chain and running them through intermediate buffers.
 * Both paths are supposed to agree about what a lane at full strength means.
 */

interface ChainReport {
	/** Hashes keyed by the arrangement that produced them. */
	frames: Record<string, string>;
	consoleErrors: string[];
}

const SIZE = 128;

async function renderArrangements(page: Page): Promise<ChainReport> {
	await page.goto("/");
	return page.evaluate(
		async ([size, sourceB64, layerB64]) => {
			const load = (path: string) => import(/* @vite-ignore */ path);
			const { GlRenderer } = await load("/src/lib/gl/renderer.ts");
			const { hydrateValues } = await load("/src/lib/effects/hydrate.ts");
			const { DEFAULT_MEDIA_STYLE } = await load("/src/lib/media/types.ts");

			const consoleErrors: string[] = [];
			const realError = console.error;
			console.error = (...args: unknown[]) => {
				consoleErrors.push(args.map((a) => String(a)).join(" "));
				realError(...args);
			};

			const bitmapOf = async (b64: string) => {
				const bytes = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
				return createImageBitmap(new Blob([bytes], { type: "image/png" }));
			};

			const canvas = document.createElement("canvas");
			canvas.width = size;
			canvas.height = size;
			const renderer = new GlRenderer(canvas);
			renderer.resize(size, size);
			renderer.loadImage(await bitmapOf(sourceB64));

			const gl = canvas.getContext("webgl2") as WebGL2RenderingContext;
			const pixels = new Uint8Array(size * size * 4);
			const sample = () => {
				gl.bindFramebuffer(gl.FRAMEBUFFER, null);
				gl.readPixels(0, 0, size, size, gl.RGBA, gl.UNSIGNED_BYTE, pixels);
				let hash = 0x811c9dc5;
				for (let i = 0; i < pixels.length; i += 4) {
					for (let c = 0; c < 3; c++) {
						hash ^= pixels[i + c];
						hash = Math.imul(hash, 0x01000193) >>> 0;
					}
				}
				return hash.toString(16);
			};

			/**
			 * Two effects picked so that order is observable. Blur mixes each pixel
			 * with its neighbours and Posterize maps each pixel on its own, so
			 * running them the other way round genuinely lands somewhere else —
			 * whereas Pixelate, the obvious first choice, commutes with any
			 * per-pixel map and would make an order test pass on nothing. Neither
			 * animates or keeps a feedback buffer, so re-rendering an arrangement
			 * gives the same frame every time.
			 */
			const fx = (
				defId: string,
				values: Record<string, number | string>,
				enabled = true,
			) => ({
				instanceId: `probe-${defId}`,
				defId,
				enabled,
				locked: false,
				expanded: false,
				values: hydrateValues(defId, values),
			});
			const blur = fx("blur", { radius: 8 });
			const posterize = fx("posterize", { levels: 2 });

			const layer = {
				key: "probe-lane",
				laneId: "probe-lane",
				underEffects: false,
				z: 0,
				sourceId: "probe-source",
				sourceTime: 0,
				style: { ...DEFAULT_MEDIA_STYLE, scale: 0.5 },
				opacity: 1,
				effects: [] as unknown[],
			};
			// Re-uploaded before every draw that uses the layer, never once up
			// front: render() garbage-collects the textures of layers absent from
			// the frame it was handed, so any render without this layer drops it.
			const layerBitmap = await bitmapOf(layerB64);
			const withLayerTexture = () =>
				renderer.updateLayerImage(layer.key, layerBitmap);

			const draw = (
				chain: unknown[] = [],
				post: unknown[] = [],
				media: unknown[] = [],
			) => {
				renderer.render(chain, 0, [], post, media);
				return sample();
			};

			const lane = (effects: unknown[], weight: number, z = 0) => ({
				effects,
				weight,
				z,
			});

			// Pulled out of the table below because each needs its texture put back
			// first, and a comma operator inside an object literal reads like a bug.
			withLayerTexture();
			const layerOver = draw([], [], [layer]);
			withLayerTexture();
			const layerTransparent = draw([], [], [{ ...layer, opacity: 0 }]);
			withLayerTexture();
			const layerUnderEffects = draw(
				[blur],
				[],
				[{ ...layer, underEffects: true }],
			);
			withLayerTexture();
			const layerOverEffects = draw(
				[blur],
				[],
				[{ ...layer, underEffects: false }],
			);

			const frames: Record<string, string> = {
				clean: draw(),

				// Chain order and repetition.
				blur: draw([blur]),
				blurTwice: draw([blur, { ...blur, instanceId: "probe-blur-2" }]),
				posterize: draw([posterize]),
				blurThenPosterize: draw([blur, posterize]),
				posterizeThenBlur: draw([posterize, blur]),
				chainDisabled: draw([fx("blur", { radius: 8 }, false)]),

				// Stacked fx lanes over an empty root chain.
				laneOff: draw([], [lane([blur], 0)]),
				laneAllDisabled: draw(
					[],
					[lane([fx("blur", { radius: 8 }, false)], 1)],
				),
				laneFull: draw([], [lane([blur], 1)]),
				laneHalf: draw([], [lane([blur], 0.5)]),
				laneEmpty: draw([], [lane([], 1)]),

				// Two lanes, and the same two with their stacking swapped.
				lanesInOrder: draw([], [lane([blur], 1, 0), lane([posterize], 1, 1)]),
				lanesSwapped: draw([], [lane([blur], 1, 1), lane([posterize], 1, 0)]),

				// Media layers composited into the chain.
				layerOver,
				layerTransparent,
				layerUnderEffects,
				layerOverEffects,
			};

			renderer.destroy();
			console.error = realError;
			return { frames, consoleErrors };
		},
		[
			SIZE,
			patternPngBase64(SIZE),
			pngBytes(RED, SIZE).toString("base64"),
		] as const,
	);
}

/** One render pass per worker, shared by every test below. */
// `{}` is Playwright's own shape for "no test-scoped fixtures, one
// worker-scoped one"; a stricter empty type doesn't satisfy its generics.
const test = base.extend<{}, { report: ChainReport }>({
	report: [
		async ({ browser }, use) => {
			const page = await browser.newPage();
			const report = await renderArrangements(page);
			await page.close();
			await use(report);
		},
		{ scope: "worker" },
	],
});

test("renders every arrangement without logging an error", async ({
	report,
}) => {
	expect(report.consoleErrors).toEqual([]);
});

test.describe("a chain of effects", () => {
	test("applies them in the order they're stacked", async ({ report }) => {
		// Reordering a chain is a one-click operation in the panel and the whole
		// point of it; if the renderer flattened order away, nothing else here
		// would notice.
		expect(report.frames.blurThenPosterize).not.toBe(
			report.frames.posterizeThenBlur,
		);
	});

	test("compounds an effect used twice", async ({ report }) => {
		expect(report.frames.blurTwice).not.toBe(report.frames.blur);
	});

	test("skips an effect that's switched off", async ({ report }) => {
		expect(report.frames.chainDisabled).toBe(report.frames.clean);
	});
});

test.describe("a stacked fx lane", () => {
	test("does nothing at zero weight", async ({ report }) => {
		expect(report.frames.laneOff).toBe(report.frames.clean);
	});

	test("does nothing when every effect on it is switched off", async ({
		report,
	}) => {
		expect(report.frames.laneAllDisabled).toBe(report.frames.clean);
	});

	test("does nothing when it carries no effects at all", async ({ report }) => {
		expect(report.frames.laneEmpty).toBe(report.frames.clean);
	});

	test("at full weight matches putting its effects in the chain", async ({
		report,
	}) => {
		// This is the contract behind the flattened fast path: when every live
		// lane is at full weight the renderer concatenates them into the root
		// chain instead of allocating buffers per lane. The two routes have to
		// produce the same frame, or a lane's look would change the moment
		// another lane's fade started.
		expect(report.frames.laneFull).toBe(report.frames.blur);
	});

	test("at a partial weight lands between the two", async ({ report }) => {
		// The other side of that branch: a weight under 1 forces the buffered
		// path, which is the one that can quietly render as either extreme.
		expect(report.frames.laneHalf).not.toBe(report.frames.clean);
		expect(report.frames.laneHalf).not.toBe(report.frames.laneFull);
	});

	test("applies lanes bottom-up, by z", async ({ report }) => {
		expect(report.frames.lanesInOrder).not.toBe(report.frames.lanesSwapped);
	});
});

test.describe("a media layer", () => {
	test("composites onto the frame", async ({ report }) => {
		expect(report.frames.layerOver).not.toBe(report.frames.clean);
	});

	test("draws nothing at zero opacity", async ({ report }) => {
		expect(report.frames.layerTransparent).toBe(report.frames.clean);
	});

	test("lands before or after the chain depending on underEffects", async ({
		report,
	}) => {
		// A layer placed under the effects is supposed to be processed by them;
		// one placed over is supposed to survive them untouched. Same layer, same
		// chain — if these match, the flag isn't doing anything.
		expect(report.frames.layerUnderEffects).not.toBe(
			report.frames.layerOverEffects,
		);
	});
});
