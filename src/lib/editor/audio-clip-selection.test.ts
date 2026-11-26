import { describe, expect, it } from "bun:test";
import { createAudioClip, createAudioLane, type AudioLane } from "../mix/types";
import { AudioClipSelection } from "./audio-clip-selection.svelte";

function setup() {
	const a = createAudioLane("Audio 1");
	const b = createAudioLane("Audio 2", true);
	const a1 = { ...createAudioClip(0, 2, "s"), fadeInSec: 0.5 };
	const a2 = createAudioClip(2, 4, "s");
	const b1 = { ...createAudioClip(0, 4, "t"), loop: true };
	a.clips = [a1, a2];
	b.clips = [b1];
	const state = {
		lanes: [a, b] as AudioLane[],
		edits: [] as (string | undefined)[],
	};
	/** The host isn't reactive, so each selection is read once. */
	const select = (...clipIds: string[]) =>
		new AudioClipSelection({
			lanes: state.lanes,
			clipIds,
			onChange: (next) => (state.lanes = next),
			onBeforeEdit: (key) => state.edits.push(key),
		});
	return { state, select, a1, a2, b1 };
}

describe("AudioClipSelection", () => {
	it("reads a value only where the selection agrees on it", () => {
		const { select, a1, a2, b1 } = setup();
		const sameLane = select(a1.id, a2.id);
		expect(sameLane.fadeInSec).toBeUndefined();
		expect(sameLane.fadeOutSec).toBe(0);
		expect(sameLane.sourceId).toBe("s");
		const mixed = select(a1.id, b1.id);
		expect(mixed.sourceId).toBeUndefined();
		expect(mixed.someLoop && !mixed.allLoop).toBe(true);
		expect(mixed.someDrive && !mixed.allDrive).toBe(true);
	});

	it("fans an edit out over every selected clip and nothing else", () => {
		const { state, select, a1, a2, b1 } = setup();
		select(a1.id, b1.id).setFade("fadeOutSec", 2);
		const clips = state.lanes.flatMap((l) => l.clips);
		const byId = (id: string) => clips.find((c) => c.id === id)!;
		expect(byId(a1.id).fadeOutSec).toBe(2);
		expect(byId(b1.id).fadeOutSec).toBe(2);
		expect(byId(a2.id).fadeOutSec).toBeUndefined();
		expect(state.edits).toHaveLength(1);
	});

	it("drops a zero fade and a unity gain from the clip", () => {
		const { state, select, a1 } = setup();
		select(a1.id).setFade("fadeInSec", 0);
		select(a1.id).setGain(1);
		const clip = state.lanes[0].clips[0];
		expect(clip.fadeInSec).toBeUndefined();
		expect(clip.gain).toBeUndefined();
	});

	it("switches Drives on the selected clips' lanes", () => {
		const { state, select, a1, b1 } = setup();
		select(a1.id, b1.id).setDrives(true);
		expect(state.lanes.every((l) => l.drives)).toBe(true);
	});
});
