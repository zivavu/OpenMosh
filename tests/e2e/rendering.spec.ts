import { expect, test as base, type Page } from "@playwright/test";

/**
 * Every effect, through the real renderer, on a real GPU context.
 *
 * The editor specs prove the pipeline runs; they say nothing about the ~50
 * shaders hanging off it, because a segment's mosh only ever rolls a handful.
 * A shader that stops compiling is caught and logged, and the effect is then
 * skipped — so the app keeps rendering, the panel keeps listing the effect, and
 * nothing anywhere goes red. That is the failure this file exists to find.
 *
 * The renderer is driven directly rather than through the UI: importing it off
 * the dev server means one page, one WebGL context and one pass over the whole
 * registry, instead of 50 trips through the editor.
 */

interface EffectResult {
	id: string;
	name: string;
	/** Differed from an empty chain at some sampled moment, at its defaults. */
	changedAtDefaults: boolean;
	/** Differed once every knob was turned up. An effect neutral at its defaults
	 * is normal — Zoom starts at 1 — but one that is neutral here is dead. */
	changedTurnedUp: boolean;
	/** Flat black at every sampled moment, in both configurations. */
	black: boolean;
	glError: number;
	/** Frame hashes at the effect's own default settings, in time order. Two
	 * effects sharing all of theirs are rendering the same thing. */
	defaultHashes: string[];
}

interface RenderReport {
	passthroughBlack: boolean;
	effects: EffectResult[];
	consoleErrors: string[];
}

/** Rendered at 128px: big enough for the spatial effects to have something to
 * displace, small enough to read back 150 times under a software rasterizer. */
const SIZE = 128;

/**
 * Several moments, none of them 0.
 *
 * One sample can't tell a broken effect from a periodic one: Strobe spends
 * most of its cycle dark, and at t=0 every animated effect is a no-op. An
 * effect has to be inert at all of these before this file calls it inert.
 */
const TIMES = [0.7, 1.37, 2.9];

async function renderEveryEffect(page: Page): Promise<RenderReport> {
	await page.goto("/");
	return page.evaluate(
		async ([size, times]) => {
			// A variable specifier: a literal would be resolved at build time, and
			// these are the dev server's own module URLs.
			const load = (path: string) => import(/* @vite-ignore */ path);
			const { GlRenderer } = await load("/src/lib/gl/renderer.ts");
			const { EFFECT_DEFINITIONS } = await load(
				"/src/lib/effects/definitions.ts",
			);
			const { hydrateValues } = await load("/src/lib/effects/hydrate.ts");

			// A compile failure is swallowed and logged, so the log is the signal.
			const consoleErrors: string[] = [];
			const realError = console.error;
			console.error = (...args: unknown[]) => {
				consoleErrors.push(args.map((a) => String(a)).join(" "));
				realError(...args);
			};

			// Detail in both axes, plus flat corners: an effect that only shifts
			// pixels needs an edge to move, and one that only shifts colour needs a
			// gradient to shift.
			const art = document.createElement("canvas");
			art.width = size;
			art.height = size;
			const ctx = art.getContext("2d")!;
			const gradient = ctx.createLinearGradient(0, 0, size, size);
			gradient.addColorStop(0, "#ff2200");
			gradient.addColorStop(0.5, "#2255ff");
			gradient.addColorStop(1, "#22ff88");
			ctx.fillStyle = gradient;
			ctx.fillRect(0, 0, size, size);
			ctx.fillStyle = "#ffffff";
			for (let y = 0; y < size; y += 16) {
				for (let x = 0; x < size; x += 16) {
					if (((x + y) / 16) % 2 === 0) ctx.fillRect(x, y, 8, 8);
				}
			}
			const bitmap = await createImageBitmap(art);

			const canvas = document.createElement("canvas");
			canvas.width = size;
			canvas.height = size;
			const renderer = new GlRenderer(canvas);
			renderer.resize(size, size);
			renderer.loadImage(bitmap);

			/**
			 * A loud, lopsided, *moving* spectrum.
			 *
			 * Moving is the part that matters: the renderer normalizes incoming
			 * spectra against a running per-bin floor, so a constant signal — however
			 * loud — normalizes to zero and every audio-reactive effect correctly
			 * renders nothing. Two pulses a second, bass-heavy, like a real track.
			 */
			const spectrum = new Uint8Array(256);
			const spectrumAt = (t: number) => {
				const pulse = 0.5 + 0.5 * Math.sin(t * Math.PI * 4);
				for (let i = 0; i < spectrum.length; i++) {
					const band = Math.exp(-i / 60);
					spectrum[i] = Math.min(
						255,
						Math.round(255 * band * (0.15 + 0.85 * pulse)),
					);
				}
				return spectrum;
			};

			const gl = canvas.getContext("webgl2") as WebGL2RenderingContext;
			const pixels = new Uint8Array(size * size * 4);

			const sample = () => {
				// The chain leaves its own framebuffer bound; the canvas is the one
				// holding the finished frame.
				gl.bindFramebuffer(gl.FRAMEBUFFER, null);
				gl.readPixels(0, 0, size, size, gl.RGBA, gl.UNSIGNED_BYTE, pixels);
				let hash = 0x811c9dc5;
				let sum = 0;
				for (let i = 0; i < pixels.length; i += 4) {
					for (let c = 0; c < 3; c++) {
						sum += pixels[i + c];
						hash ^= pixels[i + c];
						hash = Math.imul(hash, 0x01000193) >>> 0;
					}
				}
				return { hash: hash.toString(16), black: sum === 0 };
			};

			/** Put the renderer's clocks where this moment says, then draw. */
			const drawAt = (chain: unknown[], time: number) => {
				renderer.setSpectrum(spectrumAt(time), time);
				// Two beats a second, so the beat-synced effects advance too.
				renderer.setBeat(time * 2, 2);
				renderer.render(chain, time);
				return sample();
			};

			const passthrough = times.map((t) => drawAt([], t));

			/**
			 * The same effect with every knob pushed to the end of its range: ranges
			 * to their max, switches on, and a word in any text field. This is what
			 * separates "neutral until you touch it" from "wired to nothing".
			 */
			const turnedUp = (def: {
				id: string;
				params: {
					key: string;
					type: string;
					max?: number;
					defaultValue: unknown;
				}[];
			}) => {
				const values = hydrateValues(def.id, {}) as Record<
					string,
					number | string
				>;
				for (const param of def.params) {
					// Read by the host, not the shader, and "more" is the wrong
					// direction for them: smoothing at its max freezes the envelope
					// follower at zero, which reads as an effect that does nothing.
					if (param.key === "smoothing") continue;
					if (param.type === "range") values[param.key] = param.max as number;
					else if (param.type === "checkbox") values[param.key] = 1;
					else if (param.type === "text" && !values[param.key]) {
						values[param.key] = "TEST";
					}
				}
				return values;
			};

			const instanceOf = (
				defId: string,
				values: Record<string, number | string>,
			) => ({
				instanceId: `probe-${defId}`,
				defId,
				enabled: true,
				locked: false,
				expanded: false,
				values,
			});

			const effects: {
				id: string;
				name: string;
				changedAtDefaults: boolean;
				changedTurnedUp: boolean;
				black: boolean;
				glError: number;
				defaultHashes: string[];
			}[] = [];

			for (const def of EFFECT_DEFINITIONS) {
				while (gl.getError() !== gl.NO_ERROR) {
					// Drain anything an earlier effect left behind.
				}
				const atDefaults = times.map((t) =>
					drawAt([instanceOf(def.id, hydrateValues(def.id, {}))], t),
				);
				const hot = times.map((t) =>
					drawAt([instanceOf(def.id, turnedUp(def))], t),
				);
				effects.push({
					id: def.id,
					name: def.name,
					changedAtDefaults: atDefaults.some(
						(s, i) => s.hash !== passthrough[i].hash,
					),
					changedTurnedUp: hot.some((s, i) => s.hash !== passthrough[i].hash),
					// Black in both configurations, at every moment, is what counts.
					black: [...atDefaults, ...hot].every((s) => s.black),
					glError: gl.getError(),
					defaultHashes: atDefaults.map((s) => s.hash),
				});
			}

			/**
			 * Second pass, for the effects the snapshots couldn't judge.
			 *
			 * A feedback or melt effect builds its picture out of the frames before
			 * it, and a strobe is dark for most of its cycle. Three snapshots taken
			 * seconds apart show all of them doing nothing. This plays actual
			 * consecutive frames instead, which is the only way those effects were
			 * ever going to look like anything.
			 */
			const FRAMES = 30;
			const STEP = 1 / 30;
			const START = 0.5;

			const ramp = (
				values: Record<string, number | string> | null,
				defId: string,
			) => {
				const chain = values ? [instanceOf(defId, values)] : [];
				const hashes: string[] = [];
				let anyLit = false;
				for (let i = 0; i < FRAMES; i++) {
					const shot = drawAt(chain, START + i * STEP);
					hashes.push(shot.hash);
					if (!shot.black) anyLit = true;
				}
				return { hashes, anyLit };
			};

			const passthroughRamp = ramp(null, "");
			for (const effect of effects) {
				const undecided =
					(!effect.changedAtDefaults && !effect.changedTurnedUp) ||
					effect.black;
				if (!undecided) continue;
				const def = EFFECT_DEFINITIONS.find(
					(d: { id: string }) => d.id === effect.id,
				)!;
				// Both configurations get played: turned up says whether the effect
				// does anything at all, and defaults are what decides blackness —
				// Strobe with its duty maxed is *meant* to sit on a black frame.
				const hot = ramp(turnedUp(def), def.id);
				const plain = ramp(
					hydrateValues(def.id, {}) as Record<string, number | string>,
					def.id,
				);
				// Against the whole passthrough ramp: a static chain renders the same
				// frame every time, so any departure from it is the effect working.
				const baseline = new Set(passthroughRamp.hashes);
				if (hot.hashes.some((h) => !baseline.has(h)))
					effect.changedTurnedUp = true;
				if (plain.hashes.some((h) => !baseline.has(h)))
					effect.changedAtDefaults = true;
				if (hot.anyLit || plain.anyLit) effect.black = false;
				effect.defaultHashes = plain.hashes.slice(-times.length);
			}

			renderer.destroy();
			console.error = realError;
			return {
				passthroughBlack: passthrough.every((p) => p.black),
				effects,
				consoleErrors,
			};
		},
		[SIZE, TIMES] as const,
	);
}

/**
 * One render pass per worker, shared by every test below. The pass costs a
 * WebGL context and ~150 software-rendered frames; paying that per assertion
 * would make the file slower than the rest of the suite put together.
 */
// `{}` is Playwright's own shape for "no test-scoped fixtures, one
// worker-scoped one"; a stricter empty type doesn't satisfy its generics.
const test = base.extend<{}, { report: RenderReport }>({
	report: [
		async ({ browser }, use) => {
			const page = await browser.newPage();
			const report = await renderEveryEffect(page);
			await page.close();
			await use(report);
		},
		{ scope: "worker" },
	],
});

test("draws the source through an empty chain", async ({ report }) => {
	// If the baseline is black the whole report is meaningless: every effect
	// would read as "changed nothing" against it.
	expect(report.passthroughBlack).toBe(false);
});

test("has an effect to render for every definition", async ({ report }) => {
	expect(report.effects.length).toBeGreaterThan(20);
});

test("compiles every effect's shader", async ({ report }) => {
	// A compile or link failure is caught, logged, and the effect quietly does
	// nothing from then on — this log is the only place it ever surfaces.
	const failures = report.consoleErrors.filter((line) =>
		/Failed to compile|Shader compile error|Program link error|No shader for effect/i.test(
			line,
		),
	);
	expect(failures).toEqual([]);
});

test("renders every effect without a GL error", async ({ report }) => {
	const broken = report.effects
		.filter((e) => e.glError !== 0)
		.map((e) => `${e.id} (0x${e.glError.toString(16)})`);
	expect(broken).toEqual([]);
});

test("leaves no effect rendering flat black at every moment", async ({
	report,
}) => {
	// An effect whose framebuffer never got written reads as black rather than
	// as an error, and looks from the outside like a very strong effect.
	const black = report.effects.filter((e) => e.black).map((e) => e.id);
	expect(black).toEqual([]);
});

test("every effect changes the frame once it's turned up", async ({
	report,
}) => {
	// The point of the whole file: an effect that renders cleanly and does
	// nothing is indistinguishable from a working one until someone turns it on.
	// Judged with every knob at its limit, so an effect that merely starts
	// neutral doesn't read as broken.
	const inert = report.effects
		.filter((e) => !e.changedTurnedUp && !e.changedAtDefaults)
		.map((e) => e.id);
	expect(inert).toEqual([]);
});

test("gives each effect its own look", async ({ report }) => {
	// Two effects landing on identical output at every sampled moment means one
	// is wired to the other's shader — a registry copy-paste nothing else would
	// catch.
	//
	// Judged at default settings, not turned up: pushed to their limits several
	// unrelated effects saturate to the same degenerate frame, which says
	// nothing about how they're wired. Effects that are neutral at their
	// defaults sit this one out, since they all correctly look like the source.
	const byLook = new Map<string, string[]>();
	for (const effect of report.effects) {
		if (!effect.changedAtDefaults) continue;
		const key = effect.defaultHashes.join("-");
		byLook.set(key, [...(byLook.get(key) ?? []), effect.id]);
	}
	const duplicates = [...byLook.values()].filter((ids) => ids.length > 1);
	expect(duplicates).toEqual([]);
});
