import { describe, expect, it } from "bun:test";
import { EncoderPool, type PoolPacket } from "./encode-pool";
import type { EncodeWorkerResponse } from "./encode-worker";

/** A pool with no workers, fed worker replies by hand. */
function poolOf(onPacket: (p: PoolPacket) => void) {
	const pool = new EncoderPool({
		config: { codec: "vp8", width: 2, height: 2 },
		workerCount: 2,
		chunkSize: 2,
		onPacket,
	});
	const reply = (msg: EncodeWorkerResponse) =>
		(
			pool as unknown as { handleMessage(m: EncodeWorkerResponse): void }
		).handleMessage(msg);
	return { pool, reply };
}

const packet = (frameIndex: number): EncodeWorkerResponse => ({
	type: "packet",
	frameIndex,
	data: new ArrayBuffer(1),
	packetType: "delta",
	timestamp: frameIndex * 1000,
	duration: 1000,
	decoderConfig: null,
});

describe("EncoderPool", () => {
	it("hands packets on in frame order", () => {
		const out: number[] = [];
		const { reply } = poolOf((p) => out.push(p.timestamp * 1000));
		reply(packet(1));
		reply(packet(0));
		reply(packet(2));
		expect(out).toEqual([0, 1, 2]);
	});

	it("steps over a frame the encoder dropped", () => {
		const out: number[] = [];
		const { reply } = poolOf((p) => out.push(p.timestamp * 1000));
		reply(packet(0));
		reply(packet(2));
		expect(out).toEqual([0]);
		reply({ type: "dropped", frameIndex: 1 });
		expect(out).toEqual([0, 2]);
	});
});
