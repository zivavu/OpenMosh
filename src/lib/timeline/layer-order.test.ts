import { describe, expect, it } from "bun:test";
import {
  combinedLayerOrder,
  nextLayerZ,
  moveLayerTo,
  stackIndex,
  stackTitle,
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

describe("fx lanes in the stack", () => {
  it("orders alongside the layers rather than under them", () => {
    const order = combinedLayerOrder(
      [lane("m1", 0)],
      [lane("t1", 2)],
      [lane("fx1", 1)],
    );
    expect(order.map((l) => l.id)).toEqual(["t1", "fx1", "m1"]);
    expect(order.map((l) => l.kind)).toEqual(["text", "fx", "media"]);
  });

  it("loses a tie to both layer kinds, where lanes used to render", () => {
    const order = combinedLayerOrder(
      [lane("m1", 1)],
      [lane("t1", 1)],
      [lane("fx1", 1)],
    );
    expect(order.map((l) => l.id)).toEqual(["t1", "m1", "fx1"]);
  });

  it("moves through the stack like any other row", () => {
    const order = combinedLayerOrder(
      [lane("m1", 0)],
      [lane("t1", 2)],
      [lane("fx1", 1)],
    );
    expect(moveLayerTo(order, "fx1", 0)?.map((l) => l.id)).toEqual([
      "fx1",
      "t1",
      "m1",
    ]);
  });
});

describe("moveLayerTo", () => {
  it("renumbers the stack so index 0 draws on top", () => {
    const order = combinedLayerOrder(
      [lane("m1", 0), lane("m2", 1)],
      [lane("t1", 2)],
    );
    expect(order.map((l) => l.id)).toEqual(["t1", "m2", "m1"]);
    expect(moveLayerTo(order, "m1", 0)).toEqual([
      { id: "m1", z: 2 },
      { id: "t1", z: 1 },
      { id: "m2", z: 0 },
    ]);
  });

  it("carries a layer across several rows in one move", () => {
    const order = combinedLayerOrder(
      [lane("m1", 0), lane("m2", 1), lane("m3", 2)],
      [lane("t1", 3)],
    );
    expect(moveLayerTo(order, "t1", 3)?.map((l) => l.id)).toEqual([
      "m3",
      "m2",
      "m1",
      "t1",
    ]);
  });

  it("clamps to the ends and refuses a move that changes nothing", () => {
    const order = combinedLayerOrder([lane("m1", 0)], [lane("t1", 1)]);
    expect(moveLayerTo(order, "t1", -5)).toBeNull();
    expect(moveLayerTo(order, "m1", 9)).toBeNull();
    expect(moveLayerTo(order, "gone", 0)).toBeNull();
  });
});

describe("stackTitle", () => {
  const order = combinedLayerOrder(
    [lane("m1", 0), lane("m2", 2)],
    [lane("t1", 1)],
  );

  it("names both neighbours of a row in the middle", () => {
    expect(stackTitle(order, "t1")).toBe("Under m2, over m1");
  });

  it("names the one neighbour an end row has", () => {
    expect(stackTitle(order, "m2")).toBe("On top, over t1");
    expect(stackTitle(order, "m1")).toBe("At the foot, under t1");
  });

  it("says so when a row is the whole stack", () => {
    const solo = combinedLayerOrder([lane("m1", 0)], []);
    expect(stackTitle(solo, "m1")).toBe("The only row in the stack");
  });

  // A lane can outlive the order it was drawn against for a frame.
  it("stays quiet about a row that is not stacked", () => {
    expect(stackIndex(order, "gone")).toBe(-1);
    expect(stackTitle(order, "gone")).toBe("");
  });
});
