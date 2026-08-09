import { describe, expect, test } from "bun:test";
import {
  stableSourceId,
  storedMediaToFile,
  type StoredSequenceMedia,
} from "./sequence-media-store";

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

  // The whole point of a content-derived id is that storage round-trips it.
  // The File constructor defaults lastModified to Date.now(), so this only
  // holds while storedMediaToFile carries it across explicitly.
  test("a stored record rebuilds to a File with the same id", () => {
    const file = makeFile("clip.mp4", "abcdef", 1_700_000_000_000);
    const id = stableSourceId(file);
    const record: StoredSequenceMedia = {
      id,
      name: file.name,
      blob: file,
      type: file.type,
      addedAt: Date.now(),
      lastModified: file.lastModified,
    };
    expect(stableSourceId(storedMediaToFile(record))).toBe(id);
  });

  test("records predating the lastModified field recover it from the id", () => {
    const file = makeFile("old.png", "xyz", 1_600_000_000_000);
    const id = stableSourceId(file);
    const legacy = {
      id,
      name: file.name,
      blob: file,
      type: file.type,
      addedAt: Date.now(),
    } as StoredSequenceMedia;
    expect(stableSourceId(storedMediaToFile(legacy))).toBe(id);
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
