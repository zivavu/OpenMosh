import { describe, expect, it } from "bun:test";
import { layerLinkGroups } from "./audio-utils";
import { DEFAULT_AUDIO_RESPONSE } from "./auto-range";
import type { EffectInstance } from "../effects";

function lane(id: string): { id: string; effects: EffectInstance[] } {
  return { id, effects: [] as EffectInstance[] };
}

describe("layerLinkGroups", () => {
  it("scopes every lane by its own id", () => {
    const groups = layerLinkGroups(
      [lane("a"), lane("b")],
      DEFAULT_AUDIO_RESPONSE,
    );
    expect(groups.map((g) => g.scope)).toEqual(["a", "b"]);
  });

  // The audio tick writes each frame's values straight into these instances,
  // and the renderer reads the lane's chain — so a copy here would link the
  // params of a chain nothing draws.
  it("hands over the lane's own effect instances, not copies", () => {
    const l = lane("a");
    const [group] = layerLinkGroups([l], DEFAULT_AUDIO_RESPONSE);
    expect(group.effects).toBe(l.effects);
  });

  it("gives every lane the response it was handed", () => {
    const response = { ...DEFAULT_AUDIO_RESPONSE, punch: 0.8 };
    const groups = layerLinkGroups([lane("a"), lane("b")], response);
    for (const g of groups) expect(g.response).toBe(response);
  });

  it("has nothing to say about an empty stack", () => {
    expect(layerLinkGroups([], DEFAULT_AUDIO_RESPONSE)).toEqual([]);
  });
});
