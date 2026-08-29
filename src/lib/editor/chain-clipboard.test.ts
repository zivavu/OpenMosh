import { describe, expect, it } from "bun:test";
import type { EffectInstance } from "../effects";
import {
  applyChainToFxClip,
  applyChainToSegment,
  chainClipboard,
} from "./chain-clipboard";
import type { FxClip } from "./fx-lanes";
import type { SequenceSegment } from "./sequence";

/** Same shape the fx-lane tests use — the real defs aren't the point here. */
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

function segment(over: Partial<SequenceSegment> = {}): SequenceSegment {
  return {
    id: "seg-1",
    startTime: 0,
    endTime: 4,
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
  it("carries a segment's chain onto an fx clip", () => {
    chainClipboard.copy([segment({ label: "mosh", effects: effects("shift") })]);
    const target = fxClip();
    const next = applyChainToFxClip(target, chainClipboard.at(0)!);
    expect(next.label).toBe("mosh");
    expect(next.effects.map((e) => e.defId)).toEqual(["shift"]);
    // Its place on the lane is its own, not the copied segment's.
    expect(next.start).toBe(2);
    expect(next.end).toBe(6);
    expect(next.id).toBe("fx-1");
  });

  it("leaves a segment's media, span and transition alone", () => {
    chainClipboard.copy([fxClip({ label: "glowy" })]);
    const target = segment({
      sourceId: "src-b",
      transition: { type: "burn", durationSec: 0.5, seed: 3 },
      sourceRoll: true,
    });
    const next = applyChainToSegment(target, chainClipboard.at(0)!);
    expect(next.label).toBe("glowy");
    expect(next.effects.map((e) => e.defId)).toEqual(["glow"]);
    expect(next.sourceId).toBe("src-b");
    expect(next.transition?.type).toBe("burn");
    expect(next.sourceRoll).toBe(true);
    expect(next.startTime).toBe(0);
    expect(next.endTime).toBe(4);
    expect(next.id).toBe("seg-1");
  });

  it("carries the re-roll settings, which both kinds share", () => {
    chainClipboard.copy([
      fxClip({ mode: "interval", intervalSec: 0.5, intervalBeats: 1, seed: 7 }),
    ]);
    const next = applyChainToSegment(segment(), chainClipboard.at(0)!);
    expect(next.mode).toBe("interval");
    expect(next.intervalSec).toBe(0.5);
    expect(next.intervalBeats).toBe(1);
    expect(next.seed).toBe(7);
  });

  it("hands out fresh instance ids, so two pastes never share state", () => {
    chainClipboard.copy([segment()]);
    const a = chainClipboard.at(0)!;
    const b = chainClipboard.at(0)!;
    expect(a.effects[0].instanceId).not.toBe(b.effects[0].instanceId);
    expect(a.effects[0].defId).toBe(b.effects[0].defId);
  });

  it("survives the source being edited after the copy", () => {
    const src = segment();
    chainClipboard.copy([src]);
    src.effects[0].enabled = false;
    src.label = "changed";
    const chain = chainClipboard.at(0)!;
    expect(chain.effects[0].enabled).toBe(true);
    expect(chain.label).toBe("clean");
  });

  it("repeats a shorter copy over a longer selection", () => {
    chainClipboard.copy([
      segment({ id: "a", label: "one" }),
      segment({ id: "b", label: "two" }),
    ]);
    expect(chainClipboard.at(0)!.label).toBe("one");
    expect(chainClipboard.at(1)!.label).toBe("two");
    expect(chainClipboard.at(2)!.label).toBe("one");
  });

  it("bumps the stamp on every copy, so a paste can tell which is newer", () => {
    const before = chainClipboard.stamp;
    chainClipboard.copy([segment()]);
    expect(chainClipboard.stamp).toBe(before + 1);
    // An empty copy is a no-op: it must not retire a clipboard that still holds
    // something worth pasting.
    chainClipboard.copy([]);
    expect(chainClipboard.stamp).toBe(before + 1);
  });
});
