import { describe, expect, it } from "bun:test";
import { moveItem, resolveMoveTarget, type MovableRow } from "./reorder";

const ALL = ["a", "b", "c", "d", "e"];

/** Visible rows over the whole array, with `on` naming the enabled ones. */
function rows(on: string[], items = ALL): MovableRow[] {
  return items.map((name, index) => ({ index, enabled: on.includes(name) }));
}

/** Rows for a filtered view: only `shown` are visible, all enabled. */
function filtered(shown: number[]): MovableRow[] {
  return shown.map((index) => ({ index, enabled: true }));
}

/** Apply a move the way EffectsPanel does and return the resulting order. */
function move(
  visible: MovableRow[],
  pos: number,
  direction: -1 | 1,
  toEnd = false,
  items = ALL,
): string[] {
  const next = [...items];
  const to = resolveMoveTarget(visible, pos, direction, toEnd);
  if (to === null) return next;
  moveItem(next, visible[pos].index, to);
  return next;
}

const EVERY_ON = rows(ALL);

describe("resolveMoveTarget", () => {
  it("refuses to move the first item up or the last one down", () => {
    expect(resolveMoveTarget(EVERY_ON, 0, -1, false)).toBeNull();
    expect(resolveMoveTarget(EVERY_ON, 0, -1, true)).toBeNull();
    expect(resolveMoveTarget(EVERY_ON, 4, 1, false)).toBeNull();
    expect(resolveMoveTarget(EVERY_ON, 4, 1, true)).toBeNull();
  });

  it("ignores positions outside the visible list", () => {
    expect(resolveMoveTarget(EVERY_ON, -1, 1, false)).toBeNull();
    expect(resolveMoveTarget(EVERY_ON, 5, -1, false)).toBeNull();
  });

  it("targets the visible neighbour, not the array neighbour", () => {
    expect(resolveMoveTarget(filtered([0, 3]), 0, 1, false)).toBe(3);
    expect(resolveMoveTarget(filtered([0, 3]), 1, -1, false)).toBe(0);
  });
});

describe("moveItem", () => {
  it("steps one place when every effect is enabled", () => {
    expect(move(EVERY_ON, 2, -1)).toEqual(["a", "c", "b", "d", "e"]);
    expect(move(EVERY_ON, 2, 1)).toEqual(["a", "b", "d", "c", "e"]);
  });

  it("jumps to either end", () => {
    expect(move(EVERY_ON, 3, -1, true)).toEqual(["d", "a", "b", "c", "e"]);
    expect(move(EVERY_ON, 1, 1, true)).toEqual(["a", "c", "d", "e", "b"]);
  });

  it("lands adjacent to the visible neighbour when filtered", () => {
    expect(move(filtered([0, 3, 4]), 0, 1)).toEqual(["b", "c", "d", "a", "e"]);
    expect(move(filtered([0, 3, 4]), 1, -1)).toEqual(["d", "a", "b", "c", "e"]);
  });

  it("is its own inverse for single steps", () => {
    const down = move(EVERY_ON, 1, 1);
    expect(move(EVERY_ON, 2, -1, false, down)).toEqual(ALL);
  });

  it("preserves length and membership", () => {
    const out = move(EVERY_ON, 0, 1, true);
    expect(out.length).toBe(ALL.length);
    expect([...out].sort()).toEqual([...ALL].sort());
  });
});

describe("stepping over disabled effects", () => {
  // Only "a" and "d" are on: b and c are inert, so one step down from "a"
  // has to clear them and land under "d".
  const ON_A_D = rows(["a", "d"]);

  it("moves under the next enabled effect", () => {
    expect(move(ON_A_D, 0, 1)).toEqual(["b", "c", "d", "a", "e"]);
  });

  it("moves above the previous enabled effect", () => {
    expect(move(ON_A_D, 3, -1)).toEqual(["d", "a", "b", "c", "e"]);
  });

  it("skips a whole run of disabled effects", () => {
    const onFirstAndLast = rows(["a", "e"]);
    expect(move(onFirstAndLast, 0, 1)).toEqual(["b", "c", "d", "e", "a"]);
    expect(move(onFirstAndLast, 4, -1)).toEqual(["e", "a", "b", "c", "d"]);
  });

  it("falls back to the end when nothing enabled lies that way", () => {
    // "e" is off and nothing after "a" is on — go to the bottom rather than
    // leaving the button inert
    const onlyA = rows(["a"]);
    expect(move(onlyA, 1, 1)).toEqual(["a", "c", "d", "e", "b"]);
    expect(move(onlyA, 3, -1)).toEqual(["d", "a", "b", "c", "e"]);
  });

  it("does not care whether the moved effect is itself enabled", () => {
    // "b" is off, "d" is on: moving "b" down still lands it under "d"
    expect(move(rows(["d"]), 1, 1)).toEqual(["a", "c", "d", "b", "e"]);
  });
});
