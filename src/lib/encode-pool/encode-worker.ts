export type EncodeWorkerRequest =
	| { type: 'init'; config: VideoEncoderConfig }
	| { type: 'encode'; frame: VideoFrame; frameIndex: number; keyFrame: boolean }
	| { type: 'flush' };

export type EncodeWorkerResponse =
	| { type: 'ready' }
	| {
			type: 'packet';
			frameIndex: number;
			data: ArrayBuffer;
			packetType: 'key' | 'delta';
			/** Microseconds, as reported by the encoder. */
			timestamp: number;
			/** Microseconds. */
			duration: number;
			/** Present on the first packet only. */
			decoderConfig: VideoDecoderConfig | null;
	  }
	| { type: 'flushed' }
	| { type: 'error'; message: string };

let encoder: VideoEncoder | null = null;
// VP8/VP9/AV1 emit exactly one packet per frame in submission order (no
// B-frames via WebCodecs), so a FIFO maps encoder output back to frame indices.
const pendingIndices: number[] = [];
let sentDecoderConfig = false;

function post(msg: EncodeWorkerResponse, transfer?: Transferable[]) {
	(self as unknown as Worker).postMessage(msg, transfer ?? []);
}

function fail(err: unknown) {
	post({ type: 'error', message: String(err) });
}

self.onmessage = async (e: MessageEvent<EncodeWorkerRequest>) => {
	const msg = e.data;
	try {
		if (msg.type === 'init') {
			const support = await VideoEncoder.isConfigSupported(msg.config);
			if (!support.supported) {
				fail(`Encoder config not supported in worker: ${msg.config.codec}`);
				return;
			}
			encoder = new VideoEncoder({
				output: (chunk, meta) => {
					const frameIndex = pendingIndices.shift();
					if (frameIndex === undefined) {
						fail('Encoder produced more packets than frames submitted');
						return;
					}
					const data = new ArrayBuffer(chunk.byteLength);
					chunk.copyTo(data);
					const decoderConfig =
						!sentDecoderConfig && meta?.decoderConfig ? meta.decoderConfig : null;
					sentDecoderConfig = true;
					post(
						{
							type: 'packet',
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
			post({ type: 'ready' });
		} else if (msg.type === 'encode') {
			pendingIndices.push(msg.frameIndex);
			encoder!.encode(msg.frame, { keyFrame: msg.keyFrame });
			msg.frame.close();
		} else if (msg.type === 'flush') {
			await encoder!.flush();
			post({ type: 'flushed' });
		}
	} catch (err) {
		fail(err);
	}
};
