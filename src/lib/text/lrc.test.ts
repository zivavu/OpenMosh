import { describe, expect, it } from "bun:test";
import { parsePastedLyrics } from "./lrc";

describe("parsePastedLyrics", () => {
	it("takes plain lines as they are, untimed", () => {
		expect(parsePastedLyrics("one\n\n two \n")).toEqual({
			lines: ["one", "two"],
			times: [null, null],
		});
	});

	it("strips LRC stamps and tags, keeping the times", () => {
		const lrc =
			"[ar:Someone]\n[ti:Song]\n[00:12.34]First line\n[01:02.5]Second";
		expect(parsePastedLyrics(lrc)).toEqual({
			lines: ["First line", "Second"],
			times: [12.34, 62.5],
		});
	});

	it("repeats a line stamped twice, in time order", () => {
		const lrc = "[00:05.00]Verse\n[00:01.00][00:09.00]Chorus";
		const parsed = parsePastedLyrics(lrc);
		expect(parsed.lines).toEqual(["Chorus", "Verse", "Chorus"]);
		expect(parsed.times).toEqual([1, 5, 9]);
	});

	it("drops word stamps and applies the file's offset", () => {
		const lrc = "[offset:+500]\n[00:02.00]<00:02.00>Hey <00:02.50>you";
		expect(parsePastedLyrics(lrc)).toEqual({
			lines: ["Hey you"],
			times: [1.5],
		});
	});
});
