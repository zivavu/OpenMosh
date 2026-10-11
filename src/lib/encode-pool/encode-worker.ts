export type EncodeWorkerRequest =
	| { type: "init"; config: VideoEncoderConfig }
	| { type: "encode"; frame: VideoFrame; frameIndex: number; keyFrame: boolean }
	| { type: "flush" };

export type EncodeWorkerResponse =
	| { type: "ready" }
	| {
			type: "packet";
			frameIndex: number;
			data: ArrayBuffer;
			packetType: "key" | "delta";
			/** Microseconds, as reported by the encoder. */
			timestamp: number;
			/** Microseconds. */
			duration: number;
			/** Present on the first packet only. */
			decoderConfig: VideoDecoderConfig | null;
	  }
	/** The encoder skipped this frame; it will never have a packet. */
	| { type: "dropped"; frameIndex: number }
	| { type: "flushed" }
	| { type: "error"; message: string };

let encoder: VideoEncoder | null = null;
/** Frames handed to the encoder, oldest first. Output comes in submission order (no
 * B-frames via WebCodecs), but a realtime encoder may skip a frame, so each packet is
 * matched by timestamp and anything older that's still waiting was dropped. */
const pending: { frameIndex: number; timestamp: number }[] = [];
let sentDecoderConfig = false;

function post(msg: EncodeWorkerResponse, transfer?: Transferable[]) {
	(self as unknown as Worker).postMessage(msg, transfer ?? []);
}

function dropPending(until: number) {
	for (const { frameIndex } of pending.splice(0, until)) {
		post({ type: "dropped", frameIndex });
	}
}

function fail(err: unknown) {
	post({ type: "error", message: String(err) });
}

self.onmessage = async (e: MessageEvent<EncodeWorkerRequest>) => {
	const msg = e.data;
	try {
		if (msg.type === "init") {
			const support = await VideoEncoder.isConfigSupported(msg.config);
			if (!support.supported) {
				fail(`Encoder config not supported in worker: ${msg.config.codec}`);
				return;
			}
			encoder = new VideoEncoder({
				output: (chunk, meta) => {
					const at = pending.findIndex((p) => p.timestamp === chunk.timestamp);
					if (at === -1) {
						fail("Encoder produced a packet for a frame it wasn't given");
						return;
					}
					dropPending(at);
					const { frameIndex } = pending.shift()!;
					const data = new ArrayBuffer(chunk.byteLength);
					chunk.copyTo(data);
					const decoderConfig =
						!sentDecoderConfig && meta?.decoderConfig
							? meta.decoderConfig
							: null;
					sentDecoderConfig = true;
					post(
						{
							type: "packet",
							frameIndex,
							data,
							packetType: chunk.type,
							timestamp: chunk.timestamp,
							duration: chunk.duration ?? 0,
							decoderConfig,
						},
						[data],
					);
				},
				error: fail,
			});
			encoder.configure(msg.config);
			post({ type: "ready" });
		} else if (msg.type === "encode") {
			pending.push({
				frameIndex: msg.frameIndex,
				timestamp: msg.frame.timestamp,
			});
			encoder!.encode(msg.frame, { keyFrame: msg.keyFrame });
			msg.frame.close();
		} else if (msg.type === "flush") {
			await encoder!.flush();
			dropPending(pending.length);
			post({ type: "flushed" });
		}
	} catch (err) {
		fail(err);
	}
};
