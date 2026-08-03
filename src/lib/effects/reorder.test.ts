import { describe, expect, it } from "bun:test";
import { moveItem, resolveMoveTarget } from "./reorder";

/** Apply a move the way EffectsPanel does and return the resulting order. */
function move(
  items: string[],
  visibleIndices: number[],
  pos: number,
  direction: -1 | 1,
  toEnd = false,
): string[] {
  const next = [...items];
  const to = resolveMoveTarget(visibleIndices, pos, direction, toEnd);
  if (to === null) return next;
  moveItem(next, visibleIndices[pos], to);
  return next;
}

const ALL = ["a", "b", "c", "d", "e"];
const EVERY = [0, 1, 2, 3, 4];

describe("resolveMoveTarget", () => {
  it("refuses to move the first item up or the last one down", () => {
    expect(resolveMoveTarget(EVERY, 0, -1, false)).toBeNull();
    expect(resolveMoveTarget(EVERY, 0, -1, true)).toBeNull();
    expect(resolveMoveTarget(EVERY, 4, 1, false)).toBeNull();
    expect(resolveMoveTarget(EVERY, 4, 1, true)).toBeNull();
  });

  it("ignores positions outside the visible list", () => {
    expect(resolveMoveTarget(EVERY, -1, 1, false)).toBeNull();
    expect(resolveMoveTarget(EVERY, 5, -1, false)).toBeNull();
  });

  it("targets the visible neighbour, not the array neighbour", () => {
    // Rows 0 and 3 visible: moving row 0 down must jump the filtered-out items
    expect(resolveMoveTarget([0, 3], 0, 1, false)).toBe(3);
    expect(resolveMoveTarget([0, 3], 1, -1, false)).toBe(0);
  });
});

describe("moveItem", () => {
  it("steps one place in each direction", () => {
    expect(move(ALL, EVERY, 2, -1)).toEqual(["a", "c", "b", "d", "e"]);
    expect(move(ALL, EVERY, 2, 1)).toEqual(["a", "b", "d", "c", "e"]);
  });

  it("jumps to either end", () => {
    expect(move(ALL, EVERY, 3, -1, true)).toEqual(["d", "a", "b", "c", "e"]);
    expect(move(ALL, EVERY, 1, 1, true)).toEqual(["a", "c", "d", "e", "b"]);
  });

  it("lands adjacent to the visible neighbour when filtered", () => {
    // Only a, d, e visible; moving "a" down puts it directly after "d"
    expect(move(ALL, [0, 3, 4], 0, 1)).toEqual(["b", "c", "d", "a", "e"]);
    // ...and moving "d" up puts it directly before "a"
    expect(move(ALL, [0, 3, 4], 1, -1)).toEqual(["d", "a", "b", "c", "e"]);
  });

  it("is its own inverse for single steps", () => {
    const down = move(ALL, EVERY, 1, 1);
    expect(move(down, EVERY, 2, -1)).toEqual(ALL);
  });

  it("preserves length and membership", () => {
    const out = move(ALL, EVERY, 0, 1, true);
    expect(out.length).toBe(ALL.length);
    expect([...out].sort()).toEqual([...ALL].sort());
  });
});
