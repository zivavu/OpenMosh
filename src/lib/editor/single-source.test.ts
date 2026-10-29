import "fake-indexeddb/auto";
import { afterAll, beforeEach, describe, expect, mock, test } from "bun:test";
import { fakeFontModule } from "../testing/fake-fonts";
import { cleanEffects, type ChainMode } from "./sequence";
import {
	createMediaClip,
	normalizeMediaTimeline,
	type MediaTimeline,
} from "../media/types";

mock.module("../text-overlay/custom-fonts.svelte", fakeFontModule);

const localData = new Map<string, string>();
(globalThis as { localStorage?: unknown }).localStorage = {
	getItem: (k: string) => localData.get(k) ?? null,
	setItem: (k: string, v: string) => void localData.set(k, v),
	removeItem: (k: string) => void localData.delete(k),
};

const sessions = await import("./sessions");
const store = await import("./sequence-media-store");
const { openSavedSingle, singleClipIds, withSingleChain } =
	await import("./single-source");

const image = new File(["px"], "cat.png", {
	type: "image/png",
	lastModified: 1,
});

/** A chain with only the first effect on. */
function chainWithFirstOn() {
	return cleanEffects().map((e, i) => (i === 0 ? { ...e, enabled: true } : e));
}

beforeEach(async () => {
	await store.clearAllSequenceStores();
	localData.clear();
});

afterAll(() => {
	delete (globalThis as { localStorage?: unknown }).localStorage;
});

describe("openSavedSingle", () => {
	test("reads a single edit's file, chain and crop", async () => {
		const key = sessions.newSessionKey("single");
		const effects = chainWithFirstOn();
		await sessions.saveSession(key, "single", [image], { effects, text: null });
		const crop = { x: 0.1, y: 0.1, w: 0.5, h: 0.5 };
		await store.putTimeline(key, {
			sourceEdits: { [store.stableSourceId(image)]: { crop } },
		});

		const saved = await openSavedSingle(key);
		expect(saved?.file.name).toBe("cat.png");
		expect(saved?.effects[0]).toMatchObject({
			defId: effects[0].defId,
			enabled: true,
		});
		expect(saved?.sourceEdit?.crop).toMatchObject(crop);
		expect(saved?.songSpan).toBeNull();
	});

	test("is null for a slideshow or a missing edit", async () => {
		const key = sessions.newSessionKey("slideshow");
		await sessions.saveSession(key, "slideshow", [image], { config: {} });
		expect(await openSavedSingle(key)).toBeNull();
		expect(await openSavedSingle("single:p:gone")).toBeNull();
	});
});

describe("withSingleChain", () => {
	test("takes the edit's chain as a static clip, keeping what's locked", () => {
		const locked = cleanEffects().map((e, i) =>
			i === 1 ? { ...e, enabled: true, locked: true } : e,
		);
		const clip = {
			...createMediaClip(0, 4),
			mode: "interval" as ChainMode,
			effects: locked,
		};
		const next = withSingleChain(clip, chainWithFirstOn());
		expect(next.mode).toBe("static");
		expect(next.effects.filter((e) => e.enabled).map((e) => e.defId)).toEqual([
			locked[0].defId,
			locked[1].defId,
		]);
		expect(next.effects.find((e) => e.locked)?.defId).toBe(locked[1].defId);
	});
});

describe("single links", () => {
	test("survive a save and find their clips", () => {
		const linked = {
			...createMediaClip(0, 2),
			single: { sessionKey: "single:p:a", name: "Cat" },
		};
		const timeline: MediaTimeline = {
			enabled: true,
			lanes: [
				{
					id: "l1",
					name: "Cat",
					enabled: true,
					z: 0,
					sourceId: "s",
					style: normalizeMediaTimeline({ lanes: [{}] }).lanes[0].style,
					clips: [linked, createMediaClip(2, 4)],
				},
			],
		};
		const restored = normalizeMediaTimeline(
			JSON.parse(JSON.stringify(timeline)),
		);
		expect(restored.lanes[0].clips[0].single).toEqual(linked.single);
		expect(restored.lanes[0].clips[1].single).toBeUndefined();
		expect(singleClipIds(restored, "single:p:a")).toEqual([linked.id]);
	});
});
