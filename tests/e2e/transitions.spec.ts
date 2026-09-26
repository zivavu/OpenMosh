import { expect, test as base, type Page } from "@playwright/test";
import { GREEN, patternPngBase64, pngBytes } from "./fixtures";

/** Every clip transition, through the path a media layer blends on in the real renderer. A
 * transition whose shader stops compiling is caught, logged and skipped, so the blend becomes a
 * cut and nothing goes red. */

interface TransitionResult {
	type: string;
	/** Halfway through, the blend differs from both the outgoing and incoming frame:
	 * it is actually mixing rather than cutting. */
	blends: boolean;
	/** Same seed and progress at a different clock time gives the same pixels. */
	timeIndependent: boolean;
	/** Landed on the incoming clip exactly once progress reached 1. */
	settlesOnIncoming: boolean;
	/** Drawn exactly as the outgoing clip at progress 0. */
	startsOnOutgoing: boolean;
	/** Whether each knob the shader declares actually reaches it. Null means the shader
	 * doesn't read that uniform; decided from the shader source, not a list in this file. */
	respondsToSeed: boolean | null;
	respondsToDirection: boolean | null;
	respondsToDensity: boolean | null;
	glError: number;
	midHash: string;
}

interface TransitionReport {
	/** The two clips, each drawn on the layer with no transition. */
	outgoingHash: string;
	incomingHash: string;
	transitions: TransitionResult[];
	/** A type the registry has never heard of draws the incoming clip. */
	unknownTypeHash: string;
	consoleErrors: string[];
}

const SIZE = 128;

async function renderEveryTransition(page: Page): Promise<TransitionReport> {
	await page.goto("/");
	return page.evaluate(
		async ([size, baseB64, incomingB64]) => {
			const load = (path: string) => import(/* @vite-ignore */ path);
			const { GlRenderer } = await load("/src/lib/gl/renderer.ts");
			const { TRANSITION_SHADERS } = await load(
				"/src/lib/gl/transition-shaders.ts",
			);
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
			renderer.loadImage(await bitmapOf(baseB64));

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

			// Two visibly different clips on one lane, so a blend has somewhere to travel.
			const incoming = await bitmapOf(incomingB64);
			// Detailed too, and unlike the incoming pattern: a shift of a flat fill looks like no shift.
			const art = document.createElement("canvas");
			art.width = size;
			art.height = size;
			const ctx = art.getContext("2d")!;
			const gradient = ctx.createLinearGradient(0, size, size, 0);
			gradient.addColorStop(0, "#ff2200");
			gradient.addColorStop(1, "#ffdd00");
			ctx.fillStyle = gradient;
			ctx.fillRect(0, 0, size, size);
			ctx.fillStyle = "#101040";
			for (let x = 0; x < size; x += 12) ctx.fillRect(x, 0, 5, size);
			const outgoing = await createImageBitmap(art);
			const side = (key: string) => ({
				key,
				clipId: key,
				sourceId: key,
				sourceTime: 0,
				effects: [],
			});
			const layer = (key: string, transition?: unknown) => ({
				...side(key),
				laneId: "probe-lane",
				underEffects: false,
				z: 0,
				style: DEFAULT_MEDIA_STYLE,
				opacity: 1,
				transition,
			});
			const draw = (media: unknown, time: number) => {
				// Re-uploaded every draw: render() drops the textures of layers absent from its frame.
				renderer.updateLayerImage("in", incoming);
				renderer.updateLayerImage("out", outgoing);
				renderer.render([], time, [], [], [media]);
				return sample();
			};

			const SEED = 7;
			const blendAt = (
				type: string,
				progress: number,
				time: number,
				seed = SEED,
				direction = 0,
				density = 0,
			) =>
				draw(
					layer("in", {
						from: side("out"),
						concrete: { type, direction, density },
						progress,
						seed,
					}),
					time,
				);

			const incomingHash = draw(layer("in"), 0.4);
			const outgoingHash = draw(layer("out"), 0.4);

			// Every transition is header + shared helpers + its own body, and the first two mention
			// all three uniforms. The shared part is the longest common prefix, so bodies can be recovered.
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
				// The seed reaches a body as `SEED`, derived from u_seed; the other two are uniforms.
				const readsSeed = /\bSEED\b/.test(body) || body.includes("u_seed");
				const mid = blendAt(type, 0.5, 0.4);
				// The same blend, one second later: any u_time in the shader shows up as a different frame.
				const midLater = blendAt(type, 0.5, 1.4);
				const settled = blendAt(type, 1, 0.4);
				const started = blendAt(type, 0, 0.4);
				// Only asked of shaders that declare the uniform, so nothing here is hard-coded.
				const differsWith = (seed: number, dir: number, den: number) =>
					blendAt(type, 0.5, 0.4, seed, dir, den) !== mid;
				transitions.push({
					type,
					blends: mid !== incomingHash && mid !== outgoingHash,
					timeIndependent: mid === midLater,
					settlesOnIncoming: settled === incomingHash,
					startsOnOutgoing: started === outgoingHash,
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
			pngBytes(GREEN, SIZE).toString("base64"),
			patternPngBase64(SIZE),
		] as const,
	);
}

/** One render pass per worker, shared by every test below. */
// `{}` is Playwright's shape for "no test-scoped fixtures, one worker-scoped one".
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
	// Everything below compares against these two; if they matched, no blend would blend.
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
	// A transition that fails to bind a texture still renders, as one side or the other.
	const notBlending = report.transitions
		.filter((t) => !t.blends)
		.map((t) => t.type);
	expect(notBlending).toEqual([]);
});

test("blends the same way whatever the clock says", async ({ report }) => {
	// A tripwire rather than a bug hunt: transitions aren't handed a u_time today, so this
	// holds by construction. The day someone wires one in, the export drifts from the preview.
	const drifting = report.transitions
		.filter((t) => !t.timeIndependent)
		.map((t) => t.type);
	expect(drifting).toEqual([]);
});

test("wires up every knob its shader asks for", async ({ report }) => {
	// The renderer sets these behind `if (prog.uniforms[...])`, so a renamed or dropped one
	// doesn't throw: the transition just stops responding and every re-roll looks the same.
	const ignored: string[] = [];
	for (const t of report.transitions) {
		if (t.respondsToSeed === false) ignored.push(`${t.type}: u_seed`);
		if (t.respondsToDirection === false) ignored.push(`${t.type}: u_direction`);
		if (t.respondsToDensity === false) ignored.push(`${t.type}: u_density`);
	}
	expect(ignored).toEqual([]);
});

test("has a transition reading each of the three knobs", async ({ report }) => {
	// Guards the test above from passing by reading nothing: all-null would be green and check nothing.
	const declared = {
		seed: report.transitions.some((t) => t.respondsToSeed !== null),
		direction: report.transitions.some((t) => t.respondsToDirection !== null),
		density: report.transitions.some((t) => t.respondsToDensity !== null),
	};
	expect(declared).toEqual({ seed: true, direction: true, density: true });
});

test("lands exactly on the incoming clip when it finishes", async ({
	report,
}) => {
	// The blend stops the frame progress reaches 1, and the clip is drawn on its own:
	// a transition that ends a shade off jumps there at every boundary.
	const short = report.transitions
		.filter((t) => !t.settlesOnIncoming)
		.map((t) => t.type);
	expect(short).toEqual([]);
});

test("starts exactly on the outgoing clip", async ({ report }) => {
	// The other end of the same seam: the frame before the blend is the outgoing clip alone.
	const off = report.transitions
		.filter((t) => !t.startsOnOutgoing)
		.map((t) => t.type);
	expect(off).toEqual([]);
});

test("falls back to a cut for a transition it doesn't know", async ({
	report,
}) => {
	// Same path a saved timeline takes when it names a removed transition: draw the incoming clip.
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
