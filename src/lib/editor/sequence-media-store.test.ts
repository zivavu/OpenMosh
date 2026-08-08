import { describe, expect, test } from "bun:test";
import { stableSourceId } from "./sequence-media-store";

function makeFile(name: string, body: string, lastModified: number): File {
  return new File([body], name, { lastModified });
}

describe("stableSourceId", () => {
  test("is identical for the same file re-picked after a reload", () => {
    const a = makeFile("clip.mp4", "abcdef", 1_700_000_000_000);
    const b = makeFile("clip.mp4", "abcdef", 1_700_000_000_000);
    expect(stableSourceId(a)).toBe(stableSourceId(b));
  });

  test("differs on name, size or mtime", () => {
    const base = makeFile("clip.mp4", "abcdef", 1_700_000_000_000);
    const id = stableSourceId(base);
    expect(stableSourceId(makeFile("other.mp4", "abcdef", 1_700_000_000_000)))
      .not.toBe(id);
    expect(stableSourceId(makeFile("clip.mp4", "abcdefgh", 1_700_000_000_000)))
      .not.toBe(id);
    expect(stableSourceId(makeFile("clip.mp4", "abcdef", 1_700_000_000_001)))
      .not.toBe(id);
  });

  test("names containing the field separator stay distinct", () => {
    const a = makeFile("a:1:2.png", "x", 5);
    const b = makeFile("a_1_2.png", "x", 5);
    expect(stableSourceId(a)).not.toBe(stableSourceId(b));
    // A name shaped like "name:size:mtime" can't forge another file's id.
    expect(stableSourceId(makeFile("a.png:9:9", "x", 5))).not.toBe(
      stableSourceId(makeFile("a.png", "xxxxxxxxx", 9)),
    );
  });
});
