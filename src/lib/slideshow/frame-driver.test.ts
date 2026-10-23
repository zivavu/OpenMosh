import { describe, expect, it } from "bun:test";
import { SlideshowFrameDriver } from "./frame-driver";
import type { SlideshowConfig, SlideshowSlide } from "./types";
import type { GlRenderer } from "../gl/renderer";

function slide(id: string, kind: "image" | "video"): SlideshowSlide {
	return {
		id,
		kind,
		objectUrl: "",
		thumbUrl: null,
	} as unknown as SlideshowSlide;
}

const config = {
	bpm: 60,
	beatOffset: 0,
	subdivision: 1,
	moshMode: "consistent",
	moshMin: 0,
	moshMax: 0,
	smoothSpeed: 1,
	moshAudioLink: false,
	moshAudioLinkStrength: 0,
	segments: [],
	text: { enabled: false, lanes: [] },
} as unknown as SlideshowConfig;

function run(blankMissing: boolean) {
	const calls: string[] = [];
	const renderer = {
		updateSourceImage: () => calls.push("image"),
		updateSourceFrame: () => calls.push("frame"),
		clearSource: () => calls.push("clear"),
	} as unknown as GlRenderer;
	const slides = [
		slide("a", "image"),
		slide("b", "video"),
		slide("c", "image"),
	];
	const driver = new SlideshowFrameDriver({
		getConfig: () => config,
		getSlides: () => slides,
		baseEffects: [],
		getMoshOptions: () => ({}) as never,
		getRenderer: () => renderer,
		sources: {
			getImage: (s) => (s.id === "a" ? ({} as never) : undefined),
			getSampler: () => undefined,
		},
		blankMissing,
	});
	for (const t of [0.5, 1.5, 2.5]) driver.advance(t);
	return calls;
}

describe("SlideshowFrameDriver", () => {
	it("blanks slides an export couldn't read", () => {
		expect(run(true)).toEqual(["image", "clear", "clear"]);
	});

	it("holds the last picture while the preview is still loading", () => {
		expect(run(false)).toEqual(["image"]);
	});
});
