import { describe, expect, it } from "bun:test";
import {
  combinedLayerOrder,
  nextLayerZ,
  swapLayerZ,
  type OrderedLane,
} from "./layer-order";

function lane(id: string, z: number): OrderedLane {
  return { id, name: id, enabled: true, z };
}

describe("combinedLayerOrder", () => {
  it("puts the highest z first, across both kinds", () => {
    const order = combinedLayerOrder(
      [lane("m1", 0), lane("m2", 5)],
      [lane("t1", 3)],
    );
    expect(order.map((l) => l.id)).toEqual(["m2", "t1", "m1"]);
    expect(order.map((l) => l.kind)).toEqual(["media", "text", "media"]);
  });

  it("breaks a tie in favour of text, where captions used to sit", () => {
    const order = combinedLayerOrder([lane("m1", 1)], [lane("t1", 1)]);
    expect(order.map((l) => l.id)).toEqual(["t1", "m1"]);
  });
});

describe("nextLayerZ", () => {
  it("lands above everything stacked", () => {
    const order = combinedLayerOrder([lane("m1", 4)], [lane("t1", 9)]);
    expect(nextLayerZ(order)).toBe(10);
  });

  it("starts at zero on an empty stack", () => {
    expect(nextLayerZ([])).toBe(0);
  });
});

describe("swapLayerZ", () => {
  it("trades places with the neighbour and leaves the rest alone", () => {
    const order = combinedLayerOrder(
      [lane("m1", 0), lane("m2", 1)],
      [lane("t1", 2)],
    );
    expect(swapLayerZ(order, "m1", -1)).toEqual([
      { id: "m1", z: 1 },
      { id: "m2", z: 0 },
    ]);
  });

  it("reaches across the two kinds", () => {
    const order = combinedLayerOrder([lane("m1", 0)], [lane("t1", 1)]);
    expect(swapLayerZ(order, "t1", 1)).toEqual([
      { id: "t1", z: 0 },
      { id: "m1", z: 1 },
    ]);
  });

  it("nudges past a tie instead of swapping onto it", () => {
    const order = combinedLayerOrder([lane("m1", 1)], [lane("t1", 1)]);
    // t1 wins the tie-break, so moving m1 up has to actually change its z.
    expect(swapLayerZ(order, "m1", -1)).toEqual([{ id: "m1", z: 2 }]);
  });

  it("refuses to move past either end", () => {
    const order = combinedLayerOrder([lane("m1", 0)], [lane("t1", 1)]);
    expect(swapLayerZ(order, "t1", -1)).toBeNull();
    expect(swapLayerZ(order, "m1", 1)).toBeNull();
    expect(swapLayerZ(order, "gone", -1)).toBeNull();
  });
});
