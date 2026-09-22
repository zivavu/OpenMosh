import { describe, expect, it } from "bun:test";
import type { EffectInstance } from "../effects";
import { applyChainTo, chainClipboard } from "./chain-clipboard";
import type { FxClip } from "./fx-lanes";
import type { MediaClip } from "../media";

/** Same shape the fx-lane tests use: the real defs aren't the point here. */
function effects(defId: string): EffectInstance[] {
	return [
		{
			instanceId: `${defId}-1`,
			defId,
			enabled: true,
			locked: false,
			expanded: false,
			values: {},
		} as EffectInstance,
	];
}

function mediaClip(over: Partial<MediaClip> = {}): MediaClip {
	return {
		id: "mc-1",
		start: 0,
		end: 4,
		sourceStart: 1.5,
		sourceId: "src-b",
		mode: "static",
		label: "clean",
		effects: effects("vignette"),
		...over,
	};
}

function fxClip(over: Partial<FxClip> = {}): FxClip {
	return {
		id: "fx-1",
		start: 2,
		end: 6,
		label: "clean",
		mode: "static",
		effects: effects("glow"),
		...over,
	};
}

describe("chainClipboard", () => {
	it("carries a media clip's chain onto an fx clip", () => {
		chainClipboard.copy([
			mediaClip({ label: "mosh", effects: effects("shift") }),
		]);
		const target = fxClip();
		const next = applyChainTo(target, chainClipboard.at(0)!);
		expect(next.label).toBe("mosh");
		expect(next.effects.map((e) => e.defId)).toEqual(["shift"]);
		// Its place on the lane is its own, not the copied clip's.
		expect(next.start).toBe(2);
		expect(next.end).toBe(6);
		expect(next.id).toBe("fx-1");
	});

	it("leaves a media clip's source, in-point and span alone", () => {
		chainClipboard.copy([fxClip({ label: "glowy" })]);
		const target = mediaClip({ fadeInSec: 0.5 });
		const next = applyChainTo(target, chainClipboard.at(0)!);
		expect(next.label).toBe("glowy");
		expect(next.effects.map((e) => e.defId)).toEqual(["glow"]);
		expect(next.sourceId).toBe("src-b");
		expect(next.sourceStart).toBe(1.5);
		expect(next.fadeInSec).toBe(0.5);
		expect(next.start).toBe(0);
		expect(next.end).toBe(4);
		expect(next.id).toBe("mc-1");
	});

	it("carries the re-roll settings, which both kinds share", () => {
		chainClipboard.copy([
			fxClip({ mode: "interval", intervalSec: 0.5, intervalBeats: 1, seed: 7 }),
		]);
		const next = applyChainTo(mediaClip(), chainClipboard.at(0)!);
		expect(next.mode).toBe("interval");
		expect(next.intervalSec).toBe(0.5);
		expect(next.intervalBeats).toBe(1);
		expect(next.seed).toBe(7);
	});

	it("hands out fresh instance ids, so two pastes never share state", () => {
		chainClipboard.copy([mediaClip()]);
		const a = chainClipboard.at(0)!;
		const b = chainClipboard.at(0)!;
		expect(a.effects[0].instanceId).not.toBe(b.effects[0].instanceId);
		expect(a.effects[0].defId).toBe(b.effects[0].defId);
	});
});
