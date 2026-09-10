import { expect, test as base, type Page } from "@playwright/test";
import { patternPngBase64, pngBytes, RED } from "./fixtures";

/**
 * Every segment transition, through the real renderer.
 *
 * Same gap as the effects, and the same silent failure: a transition whose
 * shader stops compiling is caught, logged, and then quietly skipped — the
 * blend just becomes a cut and nothing anywhere goes red. Driven off
 * TRANSITION_SHADERS, so a new transition is covered the moment it's in the
 * registry.
 *
 * There is a second contract here that only a real render can check. The
 * shaders' own doc says every bit of randomness derives from (u_seed,
 * u_progress) and never from u_time, precisely so the preview and the export
 * produce identical blends frame for frame. That is a property, and properties
 * can be tested: render the same blend at two different clock times and the
 * pixels have to match.
 */

interface TransitionResult {
	type: string;
	/** Halfway through, the blend differs from both the outgoing and the
	 * incoming frame — it is actually mixing rather than cutting. */
	blends: boolean;
	/** Same seed and progress at a different clock time gives the same pixels. */
	timeIndependent: boolean;
	/** Landed on the incoming frame exactly once progress reached 1. */
	settlesOnIncoming: boolean;
	/**
	 * Whether each knob the shader declares actually reaches it. Null means the
	 * shader doesn't read that uniform, so there is nothing to check — decided
	 * from the shader source, not from a list kept in this file.
	 */
	respondsToSeed: boolean | null;
	respondsToDirection: boolean | null;
	respondsToDensity: boolean | null;
	glError: number;
	midHash: string;
}

interface TransitionReport {
	/** The two ends of the blend, rendered on their own. */
	outgoingHash: string;
	incomingHash: string;
	transitions: TransitionResult[];
	/** A type the registry has never heard of falls back to a hard cut. */
	unknownTypeHash: string;
	consoleErrors: string[];
}

const SIZE = 128;

async function renderEveryTransition(page: Page): Promise<TransitionReport> {
	await page.goto("/");
	return page.evaluate(
		async ([size, incomingB64, outgoingB64]) => {
			const load = (path: string) => import(/* @vite-ignore */ path);
			const { GlRenderer } = await load("/src/lib/gl/renderer.ts");
			const { TRANSITION_SHADERS } = await load(
				"/src/lib/gl/transition-shaders.ts",
			);

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

			// Two visibly different sources, so a blend between them has somewhere
			// to travel. The outgoing side is the alt texture, which is the path
			// the editor uses when two segments draw from different media.
			renderer.loadImage(await bitmapOf(incomingB64));
			renderer.updateAltSourceImage(await bitmapOf(outgoingB64));

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

			const SEED = 7;
			const blendAt = (
				type: string,
				progress: number,
				time: number,
				seed = SEED,
				direction = 0,
				density = 0,
			) => {
				renderer.renderTransition(
					[],
					[],
					type,
					progress,
					seed,
					direction,
					density,
					time,
					true,
				);
				return sample();
			};

			// The incoming frame on its own is what progress 1 has to land on.
			renderer.render([], 0);
			const incomingHash = sample();
			// And the outgoing one is the far end: progress 0 drawn from the alt
			// texture, which is as close to "before the blend" as this gets.
			const outgoingHash = blendAt("rgbslip", 0, 0);

			// Every transition is built as header + shared helpers + its own body,
			// and the first two mention all three uniforms whether or not the body
			// uses them. The shared part is exactly the longest prefix common to
			// all of them, so the bodies can be recovered without this file
			// knowing anything about how the shaders are assembled.
			const registry = TRANSITION_SHADERS as Record<
				string,
				{ fragment: string }
			>;
			const sources: string[] = Object.values(registry).map((d) => d.fragment);
			let shared = sources[0] ?? "";
			for (const src of sources.slice(1)) {
				let i = 0;
				while (i < shared.length && i < src.length && shared[i] === src[i]) i++;
				shared = shared.slice(0, i);
			}

			const transitions: TransitionResult[] = [];
			for (const type of Object.keys(TRANSITION_SHADERS)) {
				while (gl.getError() !== gl.NO_ERROR) {
					// Drain whatever an earlier transition left behind.
				}
				const body: string = TRANSITION_SHADERS[type].fragment.slice(
					shared.length,
				);
				// The seed reaches a body as `SEED`, a local the shared prefix
				// derives from u_seed; the other two are read as uniforms directly.
				const readsSeed = /\bSEED\b/.test(body) || body.includes("u_seed");
				const mid = blendAt(type, 0.5, 0.4);
				// The same blend, one second later on the clock. Any u_time in the
				// shader shows up right here as a different frame.
				const midLater = blendAt(type, 0.5, 1.4);
				const settled = blendAt(type, 1, 0.4);
				// Only asked of the shaders that declare the uniform, so this stays
				// right as transitions are added and none of it is hard-coded.
				const differsWith = (seed: number, dir: number, den: number) =>
					blendAt(type, 0.5, 0.4, seed, dir, den) !== mid;
				transitions.push({
					type,
					blends: mid !== incomingHash && mid !== outgoingHash,
					timeIndependent: mid === midLater,
					settlesOnIncoming: settled === incomingHash,
					respondsToSeed: readsSeed ? differsWith(SEED + 92, 0, 0) : null,
					respondsToDirection: body.includes("u_direction")
						? differsWith(SEED, 2, 0)
						: null,
					respondsToDensity: body.includes("u_density")
						? differsWith(SEED, 0, 2)
						: null,
					glError: gl.getError(),
					midHash: mid,
				});
			}

			const unknownTypeHash = blendAt("not-a-transition", 0.5, 0.4);

			renderer.destroy();
			console.error = realError;
			return {
				outgoingHash,
				incomingHash,
				transitions,
				unknownTypeHash,
				consoleErrors,
			};
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
const test = base.extend<{}, { report: TransitionReport }>({
	report: [
		async ({ browser }, use) => {
			const page = await browser.newPage();
			const report = await renderEveryTransition(page);
			await page.close();
			await use(report);
		},
		{ scope: "worker" },
	],
});

test("has a transition to render for every one in the registry", async ({
	report,
}) => {
	expect(report.transitions.length).toBeGreaterThan(0);
});

test("draws the two ends of a blend differently", async ({ report }) => {
	// Everything below compares against these two. If the outgoing and incoming
	// frames were the same picture, every blend would trivially "not blend".
	expect(report.outgoingHash).not.toBe(report.incomingHash);
});

test("compiles every transition's shader", async ({ report }) => {
	const failures = report.consoleErrors.filter((line) =>
		/Failed to compile transition|Shader compile error|Program link error/i.test(
			line,
		),
	);
	expect(failures).toEqual([]);
});

test("renders every transition without a GL error", async ({ report }) => {
	const broken = report.transitions
		.filter((t) => t.glError !== 0)
		.map((t) => `${t.type} (0x${t.glError.toString(16)})`);
	expect(broken).toEqual([]);
});

test("actually mixes the two sides halfway through", async ({ report }) => {
	// A transition that fails to bind one of its textures still renders — as
	// one side or the other, which reads as a cut the user didn't ask for.
	const notBlending = report.transitions
		.filter((t) => !t.blends)
		.map((t) => t.type);
	expect(notBlending).toEqual([]);
});

test("blends the same way whatever the clock says", async ({ report }) => {
	// A tripwire rather than a bug hunt: transitions aren't handed a u_time
	// today, so this holds by construction. It's here because the day someone
	// wires one in, the exported file starts disagreeing with the preview the
	// user approved — frame for frame, silently — and this is the only thing
	// watching for it.
	const drifting = report.transitions
		.filter((t) => !t.timeIndependent)
		.map((t) => t.type);
	expect(drifting).toEqual([]);
});

test("wires up every knob its shader asks for", async ({ report }) => {
	// The renderer sets these uniforms behind `if (prog.uniforms[...])`, so a
	// renamed or dropped one doesn't throw — the transition just stops
	// responding to that control, and every re-roll starts looking the same.
	const ignored: string[] = [];
	for (const t of report.transitions) {
		if (t.respondsToSeed === false) ignored.push(`${t.type}: u_seed`);
		if (t.respondsToDirection === false) ignored.push(`${t.type}: u_direction`);
		if (t.respondsToDensity === false) ignored.push(`${t.type}: u_density`);
	}
	expect(ignored).toEqual([]);
});

test("has a transition reading each of the three knobs", async ({ report }) => {
	// Guards the test above from passing by reading nothing: if every
	// `respondsTo*` were null it would be green and checking nothing at all.
	const declared = {
		seed: report.transitions.some((t) => t.respondsToSeed !== null),
		direction: report.transitions.some((t) => t.respondsToDirection !== null),
		density: report.transitions.some((t) => t.respondsToDensity !== null),
	};
	expect(declared).toEqual({ seed: true, direction: true, density: true });
});

test("lands exactly on the incoming frame when it finishes", async ({
	report,
}) => {
	// Documented fast path: at progress 1 the renderer skips the blend entirely
	// and draws chain B. A transition that ends a shade off leaves a visible
	// seam at every segment boundary.
	const short = report.transitions
		.filter((t) => !t.settlesOnIncoming)
		.map((t) => t.type);
	expect(short).toEqual([]);
});

test("falls back to a cut for a transition it doesn't know", async ({
	report,
}) => {
	// Same path a saved timeline takes when it names a transition that has
	// since been removed: draw the incoming segment rather than nothing.
	expect(report.unknownTypeHash).toBe(report.incomingHash);
});

test("gives each transition its own look", async ({ report }) => {
	const byLook = new Map<string, string[]>();
	for (const t of report.transitions) {
		byLook.set(t.midHash, [...(byLook.get(t.midHash) ?? []), t.type]);
	}
	const duplicates = [...byLook.values()].filter((ids) => ids.length > 1);
	expect(duplicates).toEqual([]);
});
