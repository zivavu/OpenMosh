import { describe, expect, it } from "bun:test";
import type { MixSegment } from "./plan";
import { scheduleMix, stopNodes } from "./schedule";

/** Audio nodes that only remember what they're wired to. */
class FakeNode {
	outputs = new Set<FakeNode>();
	gain = {
		value: 1,
		setValueAtTime: () => {},
		linearRampToValueAtTime: () => {},
	};
	playbackRate = { value: 1 };
	buffer: unknown = null;
	connect(to: FakeNode) {
		this.outputs.add(to);
	}
	disconnect() {
		this.outputs.clear();
	}
	start() {}
	stop() {}
}

function fakeContext() {
	const made: FakeNode[] = [];
	const make = () => {
		const node = new FakeNode();
		made.push(node);
		return node;
	};
	const ctx = { createBufferSource: make, createGain: make };
	return { ctx: ctx as unknown as BaseAudioContext, made };
}

const segment: MixSegment = {
	laneId: "l",
	clipId: "c",
	sourceId: "s",
	drives: true,
	start: 0,
	end: 4,
	offset: 0,
	rate: 1,
	gain: 1,
	fade: { start: 0, end: 4, fadeIn: 0.5, fadeOut: 0.5 },
};

describe("stopNodes", () => {
	it("leaves nothing a stopped segment made wired into the buses", () => {
		const { ctx, made } = fakeContext();
		const mix = new FakeNode();
		const drive = new FakeNode();
		const nodes = scheduleMix(
			ctx,
			[segment, { ...segment, start: 4, end: 8 }],
			() => ({ duration: 10 }) as AudioBuffer,
			{ mix, drive } as unknown as { mix: AudioNode; drive: AudioNode },
			0,
			8,
			0,
		);
		expect(nodes).toHaveLength(2);
		stopNodes(nodes);
		const wiredToBus = made.filter(
			(n) => n.outputs.has(mix) || n.outputs.has(drive),
		);
		expect(wiredToBus).toEqual([]);
	});
});
