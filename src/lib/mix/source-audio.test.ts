import { describe, expect, it } from "bun:test";
import { SourceAudioBank } from "./source-audio.svelte";

// Nothing decodes under bun, so every source settles as silent: enough to see which
// entries the bank keeps.
const bank = () =>
	new SourceAudioBank((id) => new File(["x"], `${id}.bin`, { type: "" }));

describe("SourceAudioBank.retain", () => {
	it("lets go of what's no longer kept, and only that", async () => {
		const audio = bank();
		await audio.settle(["kept", "gone"]);
		expect(audio.isSilent("kept")).toBe(true);
		expect(audio.isSilent("gone")).toBe(true);
		audio.retain(new Set(["kept"]));
		expect(audio.isSilent("kept")).toBe(true);
		// Unknown again: asked for later, it decodes afresh.
		expect(audio.isSilent("gone")).toBe(false);
	});

	it("leaves a decode in progress to finish", async () => {
		let asked = 0;
		const audio = new SourceAudioBank((id) => {
			asked++;
			return new File(["x"], `${id}.bin`);
		});
		audio.ensure(["busy"]);
		audio.retain(new Set());
		await audio.settle(["busy"]);
		expect(asked).toBe(1);
		expect(audio.isSilent("busy")).toBe(true);
	});
});
