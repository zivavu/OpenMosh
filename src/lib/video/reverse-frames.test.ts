import { afterAll, describe, expect, it } from "bun:test";
import type { FrameQueue } from "./decode";
import { ReverseFrames } from "./reverse-frames";

const globals = globalThis as Record<string, unknown>;
globals.createImageBitmap = async () => ({ close() {} });
globals.VideoFrame = class {
	timestamp: number;
	constructor(_image: unknown, init: { timestamp: number }) {
		this.timestamp = init.timestamp;
	}
	close() {}
};
afterAll(() => {
	delete globals.createImageBitmap;
	delete globals.VideoFrame;
});

/** A second of media, a frame every 0.1s. */
function queue(): FrameQueue {
	const all = Array.from({ length: 10 }, (_, i) => i * 100_000);
	let next = 0;
	return {
		started: true,
		head: 0,
		received: 0,
		get size() {
			return all.length - next;
		},
		get done() {
			return next >= all.length;
		},
		start(t) {
			next = all.findIndex((ts) => ts >= t * 1e6);
			if (next < 0) next = all.length;
		},
		takeDue: () => null,
		takeHead() {
			if (next >= all.length) return null;
			const timestamp = all[next++];
			return {
				timestamp,
				displayWidth: 4,
				displayHeight: 4,
				close() {},
			} as unknown as VideoFrame;
		},
		dispose() {},
	};
}

describe("ReverseFrames", () => {
	it("hands a frame out once while the backward pass stands still", async () => {
		const reverse = new ReverseFrames(async () => queue());
		const first = await reverse.frameAt(0.25);
		expect(first?.timestamp).toBe(200_000);
		// The same frame again would be uploaded again, and a paused preview redraws on
		// every upload: that loop never yielded.
		expect(await reverse.frameAt(0.25, first!.timestamp)).toBeNull();
		expect((await reverse.frameAt(0.15, first!.timestamp))?.timestamp).toBe(
			100_000,
		);
		reverse.dispose();
	});
});
