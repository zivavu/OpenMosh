import { describe, expect, it } from "bun:test";
import { pickTopLayer, pointInLayer, type LayerHitBox } from "./layer-pick";

function box(over: Partial<LayerHitBox> = {}): LayerHitBox {
  return {
    kind: "media",
    laneId: "a",
    underEffects: false,
    z: 0,
    cx: 100,
    cy: 100,
    w: 40,
    h: 20,
    rot: 0,
    ...over,
  };
}

describe("pointInLayer", () => {
  it("hits inside the box and misses outside it", () => {
    const b = box();
    expect(pointInLayer(b, 100, 100)).toBe(true);
    expect(pointInLayer(b, 119, 109)).toBe(true);
    expect(pointInLayer(b, 121, 100)).toBe(false);
    expect(pointInLayer(b, 100, 111)).toBe(false);
  });

  it("follows the box's rotation rather than its axis-aligned span", () => {
    const b = box({ rot: Math.PI / 2 });
    // The long side now runs vertically, so the corners of the unrotated box
    // fall outside and the ends of the rotated one fall in.
    expect(pointInLayer(b, 118, 100)).toBe(false);
    expect(pointInLayer(b, 100, 118)).toBe(true);
  });

  it("misses a box with no size", () => {
    expect(pointInLayer(box({ w: 0 }), 100, 100)).toBe(false);
  });
});

describe("pickTopLayer", () => {
  it("returns nothing when the point misses every layer", () => {
    expect(pickTopLayer([box(), box({ laneId: "b" })], 500, 500)).toBe(null);
  });

  it("takes the highest z of the layers hit", () => {
    const hit = pickTopLayer(
      [box({ laneId: "low", z: 1 }), box({ laneId: "high", z: 5 })],
      100,
      100,
    );
    expect(hit?.laneId).toBe("high");
  });

  it("ignores a higher z the point misses", () => {
    const hit = pickTopLayer(
      [box({ laneId: "under", z: 1 }), box({ laneId: "away", z: 9, cx: 400 })],
      100,
      100,
    );
    expect(hit?.laneId).toBe("under");
  });

  it("puts every over-chain layer above every under-chain one", () => {
    const hit = pickTopLayer(
      [
        box({ laneId: "over", z: 0 }),
        box({ laneId: "under", z: 9, underEffects: true }),
      ],
      100,
      100,
    );
    expect(hit?.laneId).toBe("over");
  });

  it("picks among under-chain layers by z when nothing sits over them", () => {
    const hit = pickTopLayer(
      [
        box({ laneId: "low", z: 0, underEffects: true }),
        box({ laneId: "high", z: 3, underEffects: true }),
      ],
      100,
      100,
    );
    expect(hit?.laneId).toBe("high");
  });

  it("breaks a z tie with the later layer, as the composite does", () => {
    const hit = pickTopLayer(
      [box({ laneId: "first" }), box({ laneId: "second", kind: "text" })],
      100,
      100,
    );
    expect(hit?.laneId).toBe("second");
  });
});
