import { describe, expect, test } from "bun:test";
import { SaveTracker } from "./save-status.svelte";

describe("SaveTracker", () => {
	test("a save queued during playback is held, not saving", () => {
		const saves = new SaveTracker();
		saves.schedule("session");
		expect(saves.state).toBe("saving");
		saves.playing = true;
		expect(saves.state).toBe("held");
		saves.playing = false;
		expect(saves.state).toBe("saving");
	});

	test("a write in flight reads as saving even while playing", async () => {
		const saves = new SaveTracker();
		saves.playing = true;
		let finish!: (ok: boolean) => void;
		const done = saves.track("timeline", new Promise((r) => (finish = r)));
		expect(saves.state).toBe("saving");
		finish(true);
		await done;
		expect(saves.state).toBe("saved");
	});

	test("a failure outranks a held save", async () => {
		const saves = new SaveTracker();
		saves.playing = true;
		saves.schedule("session");
		await saves.track("pool", Promise.resolve(false));
		expect(saves.state).toBe("failed");
	});
});
