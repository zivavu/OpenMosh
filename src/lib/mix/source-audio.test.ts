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

describe("SourceAudioBank.load", () => {
	it("hands over a decode that a retain let go of before it was read", async () => {
		const sound = {
			length: 4,
			numberOfChannels: 1,
			sampleRate: 4,
			duration: 1,
			getChannelData: () => new Float32Array(4),
		} as unknown as AudioBuffer;
		const audio = new SourceAudioBank(
			(id) => new File(["x"], `${id}.mp3`),
			async () => sound,
		);
		const loading = audio.load("dropped");
		while (!audio.hasAudio("dropped")) await Promise.resolve();
		// Not on a lane yet, so the mix effect's retain doesn't keep it.
		audio.retain(new Set());
		expect(await loading).toBe(sound);
	});
});
