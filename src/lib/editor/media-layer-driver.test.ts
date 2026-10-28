import { describe, expect, it, mock } from "bun:test";
import type { ResolvedMediaLayer } from "../media";
import type { CutList } from "../media/cut-list";

/** Every sampler the driver opened, and whether it was let go. */
const opened: { file: File; disposed: boolean }[] = [];

// The mock lasts the whole run, so it keeps the module's other exports for later files.
const sampler = await import("../slideshow/video-sampler");
mock.module("../slideshow/video-sampler", () => ({
	...sampler,
	SlideVideoSampler: {
		create: async (file: File) => {
			const entry = { file, disposed: false };
			opened.push(entry);
			return {
				at: async () => null,
				dispose: () => (entry.disposed = true),
			};
		},
	},
}));

const { MediaLayerDriver } = await import("./media-layer-driver");

const video = (id: string) => ({
	id,
	kind: "video",
	file: new File([id], `${id}.mp4`),
});

/** A frame where `lane` shows `sourceId`. */
const layer = (lane: string, sourceId: string) =>
	({ key: lane, sourceId, sourceTime: 0 }) as unknown as ResolvedMediaLayer;

function driver(sources: { id: string; kind: string; cutList?: CutList }[]) {
	const byId = new Map(sources.map((s) => [s.id, s]));
	return new MediaLayerDriver({
		registry: { sources, get: (id: string) => byId.get(id) } as never,
		getRenderer: () => null,
	});
}

/** Lets the async sampler creation settle. */
const settle = () => new Promise((r) => setTimeout(r, 0));

describe("MediaLayerDriver", () => {
	it("frees the decoders of lanes that are gone, past the total cap", async () => {
		opened.length = 0;
		const sources = Array.from({ length: 20 }, (_, i) => video(`v${i}`));
		const d = driver(sources);
		// Twenty lanes, each shown once and then deleted.
		for (let i = 0; i < 20; i++) {
			d.advance([layer(`lane${i}`, `v${i}`)]);
			await settle();
		}
		expect(opened).toHaveLength(20);
		expect(opened.filter((o) => !o.disposed)).toHaveLength(12);
		// The oldest went first.
		expect(opened[0].disposed).toBe(true);
		expect(opened[19].disposed).toBe(false);
	});

	it("keeps every decoder the current frame uses, whatever the cap", async () => {
		opened.length = 0;
		const sources = Array.from({ length: 14 }, (_, i) => video(`v${i}`));
		const d = driver(sources);
		const frame = sources.map((s, i) => layer(`lane${i}`, s.id));
		d.advance(frame);
		await settle();
		d.advance(frame);
		await settle();
		expect(opened).toHaveLength(14);
		expect(opened.every((o) => !o.disposed)).toBe(true);
	});

	it("keeps a lane's decoder through a gap between its clips", async () => {
		opened.length = 0;
		const d = driver([video("a")]);
		d.advance([layer("lane", "a")]);
		await settle();
		d.advance([]);
		d.advance([layer("lane", "a")]);
		await settle();
		expect(opened).toHaveLength(1);
		expect(opened[0].disposed).toBe(false);
	});

	it("keeps every decoder of a lane under its cap", async () => {
		opened.length = 0;
		const sources = ["a", "b", "c"].map(video);
		const d = driver(sources);
		for (let pass = 0; pass < 2; pass++) {
			for (const s of sources) {
				d.advance([layer("lane", s.id)]);
				await settle();
			}
		}
		expect(opened).toHaveLength(3);
		expect(opened.every((o) => !o.disposed)).toBe(true);
	});

	it("keeps a decoder for each video slide a slideshow cycles through", async () => {
		opened.length = 0;
		const slides = Array.from({ length: 6 }, (_, i) => video(`v${i}`));
		const cutList = {
			duration: 6,
			songStart: 0,
			slides: slides.map((s) => s.id),
			cuts: slides.map((_, i) => [i, i]),
		} as unknown as CutList;
		const d = driver([...slides, { id: "show", kind: "cuts", cutList }]);
		const at = (t: number) =>
			({ key: "lane", sourceId: "show", sourceTime: t }) as ResolvedMediaLayer;
		for (let pass = 0; pass < 2; pass++) {
			for (let t = 0; t < 6; t++) {
				d.advance([at(t + 0.5)]);
				await settle();
			}
		}
		expect(opened).toHaveLength(6);
		expect(opened.every((o) => !o.disposed)).toBe(true);
	});
});
