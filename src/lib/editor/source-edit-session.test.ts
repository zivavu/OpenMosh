import { describe, expect, test } from "bun:test";
import { SourceEditSession } from "./source-edit-session";

function session() {
	const calls: string[] = [];
	const s = new SourceEditSession<"rail" | "clip">({
		onOpen: () => calls.push("open"),
		onClose: () => calls.push("close"),
	});
	return { s, calls };
}

describe("SourceEditSession", () => {
	test("opens and closes once per session", () => {
		const { s, calls } = session();
		s.report("clip", true);
		s.report("clip", true);
		expect(s.isOpen).toBe(true);
		s.report("clip", false);
		s.report("clip", false);
		expect(s.isOpen).toBe(false);
		expect(calls).toEqual(["open", "close"]);
	});

	// The rail reporting "closed" while the clip panel's editor is up used to flip the
	// shared flag back and forth until Svelte gave up on the update loop.
	test("another reporter's closed state doesn't end the session", () => {
		const { s, calls } = session();
		s.report("rail", false);
		s.report("clip", true);
		for (let i = 0; i < 5; i++) {
			s.report("rail", false);
			s.report("clip", true);
		}
		expect(s.isOpen).toBe(true);
		expect(calls).toEqual(["open"]);
	});

	test("stays open until every reporter has closed", () => {
		const { s, calls } = session();
		s.report("rail", true);
		s.report("clip", true);
		s.report("rail", false);
		expect(s.isOpen).toBe(true);
		s.report("clip", false);
		expect(s.isOpen).toBe(false);
		expect(calls).toEqual(["open", "close"]);
	});
});
