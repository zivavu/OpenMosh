import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { createTrackStore } from "./track-persistence";

/** localStorage with a byte cap, so a write can be pushed over quota. */
function installStorage(limit: number) {
  const data = new Map<string, string>();
  const store = {
    getItem: (k: string) => data.get(k) ?? null,
    setItem: (k: string, v: string) => {
      let total = v.length;
      for (const [key, val] of data) if (key !== k) total += val.length;
      if (total > limit) throw new Error("QuotaExceededError");
      data.set(k, v);
    },
    removeItem: (k: string) => void data.delete(k),
  };
  (globalThis as { localStorage?: unknown }).localStorage = store;
  return data;
}

const KEY = "test-store";

describe("createTrackStore", () => {
  beforeEach(() => installStorage(1_000_000));
  afterEach(() => {
    delete (globalThis as { localStorage?: unknown }).localStorage;
  });

  it("round-trips an entry", () => {
    const store = createTrackStore<{ n: number }>(KEY);
    expect(store.save("a", { n: 1 })).toBe(true);
    expect(store.load("a")).toEqual({ n: 1 });
    expect(store.load("b")).toBeNull();
  });

  it("keeps other songs' entries", () => {
    const store = createTrackStore<{ n: number }>(KEY);
    store.save("a", { n: 1 });
    store.save("b", { n: 2 });
    expect(store.load("a")).toEqual({ n: 1 });
    expect(store.load("b")).toEqual({ n: 2 });
  });

  it("evicts the least recently saved song rather than failing the write", () => {
    installStorage(250);
    const store = createTrackStore<{ pad: string }>(KEY);
    const big = { pad: "x".repeat(100) };
    expect(store.save("a", big)).toBe(true);
    expect(store.save("b", big)).toBe(true);
    // Three no longer fit; the oldest goes so the newest can be written.
    expect(store.save("c", big)).toBe(true);
    expect(store.load("c")).toEqual(big);
    expect(store.load("a")).toBeNull();
  });

  it("re-saving a song makes it the most recent, so it isn't the one evicted", () => {
    installStorage(250);
    const store = createTrackStore<{ pad: string }>(KEY);
    const big = { pad: "x".repeat(100) };
    store.save("a", big);
    store.save("b", big);
    store.save("a", big);
    store.save("c", big);
    expect(store.load("a")).toEqual(big);
    expect(store.load("b")).toBeNull();
  });

  it("reports failure when even one entry can't fit", () => {
    installStorage(10);
    const store = createTrackStore<{ pad: string }>(KEY);
    expect(store.save("a", { pad: "x".repeat(100) })).toBe(false);
  });
});
