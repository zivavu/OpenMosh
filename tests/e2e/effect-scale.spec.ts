import { expect, test } from "@playwright/test";
import { patternPngBase64 } from "./fixtures";

/** Effects that size things in pixels have to look the same at any render size: the
 * preview renders at the size it's shown, the export at the media's own. */

/** Both past the effect frame's 720px, where a one-texel floor can't step in. */
const SMALL = 768;
const LARGE = 1536;

const EFFECTS: [string, Record<string, number | string>][] = [
	["pixelate", { size: 12 }],
	["halftone", {}],
	["slices", {}],
	["neon-edges", {}],
	["sharpen", {}],
	["jitter", { amount: 80 }],
	["blur", { radius: 8 }],
	["glow", {}],
	["channel-split", {}],
	["wobble", {}],
];

test("pixel-sized effects match between a small and a large render", async ({
	page,
}) => {
	await page.goto("/");
	const report = await page.evaluate(
		async ([small, large, sourceB64, effects]) => {
			const load = (path: string) => import(/* @vite-ignore */ path);
			const { GlRenderer } = await load("/src/lib/gl/renderer.ts");
			const { hydrateValues } = await load("/src/lib/effects/hydrate.ts");
			const bytes = Uint8Array.from(atob(sourceB64), (c) => c.charCodeAt(0));
			const source = await createImageBitmap(
				new Blob([bytes], { type: "image/png" }),
			);

			// One renderer for both sizes: past a dozen contexts the browser drops the oldest.
			const canvas = document.createElement("canvas");
			const renderer = new GlRenderer(canvas);

			const gl = canvas.getContext("webgl2") as WebGL2RenderingContext;

			/** The render at `size`, box-averaged down to the small size for comparing. */
			const renderAt = (size: number, chain: unknown[]) => {
				// The source at the render's size, as a chain's later effects see it.
				const art = new OffscreenCanvas(size, size);
				const artCtx = art.getContext("2d")!;
				artCtx.imageSmoothingEnabled = false;
				artCtx.drawImage(source, 0, 0, size, size);
				renderer.loadImage(art);
				renderer.render(chain, 1.3);
				const pixels = new Uint8Array(size * size * 4);
				gl.bindFramebuffer(gl.FRAMEBUFFER, null);
				gl.readPixels(0, 0, size, size, gl.RGBA, gl.UNSIGNED_BYTE, pixels);
				const k = size / small;
				const out = new Float32Array(small * small * 4);
				for (let y = 0; y < size; y++) {
					for (let x = 0; x < size; x++) {
						const from = (y * size + x) * 4;
						const to = (Math.floor(y / k) * small + Math.floor(x / k)) * 4;
						for (let c = 0; c < 4; c++)
							out[to + c] += pixels[from + c] / (k * k);
					}
				}
				return out;
			};
			const diff = (a: Float32Array, b: Float32Array) => {
				let sum = 0;
				for (let i = 0; i < a.length; i += 4) {
					for (let c = 0; c < 3; c++) sum += Math.abs(a[i + c] - b[i + c]);
				}
				return sum / ((a.length / 4) * 3);
			};

			const clean = renderAt(small, []);
			return effects.map(([defId, values]) => {
				const chain = [
					{
						instanceId: `probe-${defId}`,
						defId,
						enabled: true,
						locked: false,
						expanded: false,
						values: hydrateValues(defId, values),
					},
				];
				const a = renderAt(small, chain);
				const b = renderAt(large, chain);
				return { defId, effect: diff(a, clean), sizes: diff(a, b) };
			});
		},
		[SMALL, LARGE, patternPngBase64(), EFFECTS] as const,
	);
	for (const { defId, effect, sizes } of report) {
		expect(sizes, `${defId} looks different at ${LARGE}px`).toBeLessThan(
			effect / 4,
		);
	}
});
