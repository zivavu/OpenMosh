import "fake-indexeddb/auto";
import { beforeEach, describe, expect, test } from "bun:test";
import { addTrack, clearTracks, getAllTracks } from "./track-library";

beforeEach(() => clearTracks());

describe("addTrack", () => {
	test("hands back the stored song for the same file", async () => {
		const first = await addTrack(new File(["abcd"], "song.mp3"));
		const again = await addTrack(new File(["abcd"], "song.mp3"));
		expect(again.id).toBe(first.id);
		expect(await getAllTracks()).toHaveLength(1);
	});

	test("stores a different song that shares a name and size", async () => {
		const first = await addTrack(new File(["abcd"], "song.mp3"));
		const other = await addTrack(new File(["wxyz"], "song.mp3"));
		expect(other.id).not.toBe(first.id);
		expect(await other.blob.text()).toBe("wxyz");
	});
});
