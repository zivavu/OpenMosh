import "fake-indexeddb/auto";
import { afterAll, beforeEach, describe, expect, mock, test } from "bun:test";
import { fakeFontModule } from "../testing/fake-fonts";
import type { CutList } from "../media/cut-list";
import type { MediaTimeline } from "../media";

mock.module("../text-overlay/custom-fonts.svelte", fakeFontModule);

const localData = new Map<string, string>();
(globalThis as { localStorage?: unknown }).localStorage = {
	getItem: (k: string) => localData.get(k) ?? null,
	setItem: (k: string, v: string) => void localData.set(k, v),
	removeItem: (k: string) => void localData.delete(k),
};

const sessions = await import("./sessions");
const store = await import("./sequence-media-store");
const { freezeSavedSlideshow, hiddenSlides, slidesLeftBehind } =
	await import("./slideshow-source");

const slide = (name: string) =>
	new File([name], name, { type: "image/png", lastModified: 1 });

beforeEach(async () => {
	await store.clearAllSequenceStores();
	localData.clear();
});

afterAll(() => {
	delete (globalThis as { localStorage?: unknown }).localStorage;
});

describe("freezeSavedSlideshow", () => {
	test("cuts a saved slideshow's slides on its own beat, over its span", async () => {
		const key = sessions.newSessionKey("slideshow");
		const files = [slide("a.png"), slide("b.png")];
		await sessions.saveSession(key, "slideshow", files, {
			config: {
				bpm: 60,
				beatOffset: 0,
				subdivision: 1,
				span: { start: 2, end: 5 },
			},
		});
		const frozen = await freezeSavedSlideshow(key, "Show");
		expect(frozen?.cutList).toMatchObject({
			name: "Show",
			sessionKey: key,
			duration: 3,
			songStart: 2,
			bpm: 60,
			slides: files.map(store.stableSourceId),
			cuts: [
				[0, 0],
				[1, 1],
				[2, 0],
			],
		});
	});

	test("runs a songless slideshow for its export length", async () => {
		const key = sessions.newSessionKey("slideshow");
		await sessions.saveSession(key, "slideshow", [slide("a.png")], {
			config: { moshMode: "consistent" },
		});
		const frozen = await freezeSavedSlideshow(key, "Show");
		expect(frozen?.cutList.duration).toBe(30);
	});

	test("keeps the slideshow's output size and fit", async () => {
		const key = sessions.newSessionKey("slideshow");
		await sessions.saveSession(key, "slideshow", [slide("a.png")], {
			config: {},
		});
		const { saveRenderSettings } = await import("./render-settings");
		saveRenderSettings(key, { width: 1080, height: 1920 });
		const { updateSettings } = await import("./settings");
		updateSettings({ sourceFit: "cover" });
		const frozen = await freezeSavedSlideshow(key, "Show");
		expect(frozen?.cutList.frame).toEqual({
			width: 1080,
			height: 1920,
			fit: "cover",
		});
	});

	test("is null for a slideshow that's gone", async () => {
		expect(await freezeSavedSlideshow("slideshow:p:gone", "Show")).toBeNull();
	});
});

describe("slideshow slides in the pool", () => {
	const list = (slides: string[]) => ({ slides }) as CutList;
	const sources = [
		{ id: "a" },
		{ id: "b" },
		{ id: "c" },
		{ id: "show1", cutList: list(["a", "b"]) },
		{ id: "show2", cutList: list(["b", "c"]) },
	];
	const timeline = (ids: string[]) =>
		({
			enabled: true,
			lanes: ids.map((id) => ({ id, sourceId: id, clips: [] })),
		}) as unknown as MediaTimeline;

	const slideOnly = new Set(["a", "b", "c"]);

	test("hide unless a clip shows one", () => {
		expect([
			...hiddenSlides(sources, timeline(["show1", "c"]), slideOnly),
		]).toEqual(["a", "b"]);
	});

	test("stay listed when they were in the pool before their slideshow", () => {
		expect([
			...hiddenSlides(sources, timeline(["show1"]), new Set(["b"])),
		]).toEqual(["b"]);
		expect(hiddenSlides(sources, timeline(["show1"]), new Set()).size).toBe(0);
	});

	test("leave with their slideshow unless another plays them or a clip shows them", () => {
		expect(
			slidesLeftBehind(sources, "show1", timeline(["show1"]), slideOnly),
		).toEqual(["a"]);
		expect(
			slidesLeftBehind(sources, "show1", timeline(["a"]), slideOnly),
		).toEqual([]);
	});

	test("never take media that was in the pool on its own", () => {
		expect(
			slidesLeftBehind(sources, "show1", timeline(["show1"]), new Set()),
		).toEqual([]);
	});
});
