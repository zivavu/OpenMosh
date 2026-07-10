import type {
	EncodeWorkerRequest,
	EncodeWorkerResponse,
} from './encode-worker';

export interface PoolPacket {
	data: Uint8Array;
	type: 'key' | 'delta';
	/** Seconds. */
	timestamp: number;
	/** Seconds. */
	duration: number;
	decoderConfig: VideoDecoderConfig | null;
}

export interface EncoderPoolOptions {
	config: VideoEncoderConfig;
	workerCount: number;
	/** Frames per chunk. Each chunk starts with a forced keyframe and is encoded
	 * wholly by one worker, so chunks are independent VP8 streams that remain
	 * valid when interleaved back in frame order. */
	chunkSize: number;
	/** Called once per frame, strictly in frame order. */
	onPacket: (packet: PoolPacket) => void;
}

/**
 * Farms software video encoding out to N worker threads. Chrome/Firefox run
 * one software encoder mostly single-pipeline, so parallel encoder instances
 * scale throughput with cores. Frames are assigned round-robin by chunk;
 * packets are reordered back to global frame order before being emitted.
 */
export class EncoderPool {
	private workers: Worker[] = [];
	private pending = new Map<number, PoolPacket>();
	private nextEmitIndex = 0;
	private inFlight = 0;
	private readonly maxInFlight: number;
	private slotWaiters: (() => void)[] = [];
	private failure: Error | null = null;
	private failureWaiters: ((err: Error) => void)[] = [];
	private flushedCount = 0;
	private flushWaiter: (() => void) | null = null;

	static isSupported(): boolean {
		return (
			typeof Worker !== 'undefined' &&
			typeof VideoFrame !== 'undefined' &&
			typeof VideoEncoder !== 'undefined'
		);
	}

	constructor(private opts: EncoderPoolOptions) {
		// One chunk per worker in flight keeps every worker fed; every submitted
		// frame produces a packet independently, so this can never deadlock.
		this.maxInFlight = opts.chunkSize * opts.workerCount;
	}

	/** Spawns and configures the workers. Throws if any worker rejects the config. */
	async init(): Promise<void> {
		const readies: Promise<void>[] = [];
		for (let i = 0; i < this.opts.workerCount; i++) {
			const worker = new Worker(
				new URL('./encode-worker.ts', import.meta.url),
				{ type: 'module' },
			);
			this.workers.push(worker);
			readies.push(
				new Promise<void>((resolve, reject) => {
					const onReady = (e: MessageEvent<EncodeWorkerResponse>) => {
						if (e.data.type === 'ready') {
							worker.removeEventListener('message', onReady);
							worker.addEventListener('message', (ev) =>
								this.handleMessage(ev.data as EncodeWorkerResponse),
							);
							resolve();
						} else if (e.data.type === 'error') {
							reject(new Error(e.data.message));
						}
					};
					worker.addEventListener('message', onReady);
					worker.addEventListener('error', (e) =>
						reject(new Error(e.message || 'Encode worker failed to start')),
					);
				}),
			);
			this.post(worker, { type: 'init', config: this.opts.config });
		}
		try {
			await Promise.all(readies);
		} catch (err) {
			this.dispose();
			throw err;
		}
	}

	/** Captures the canvas and queues it for encoding. Awaits a free slot. */
	async submit(
		canvas: HTMLCanvasElement,
		frameIndex: number,
		timestampS: number,
		durationS: number,
	): Promise<void> {
		this.throwIfFailed();
		if (this.inFlight >= this.maxInFlight) {
			await new Promise<void>((resolve, reject) => {
				this.slotWaiters.push(resolve);
				this.failureWaiters.push(reject);
			});
			this.throwIfFailed();
		}
		this.inFlight++;
		const frame = new VideoFrame(canvas, {
			timestamp: Math.round(timestampS * 1e6),
			duration: Math.round(durationS * 1e6),
		});
		const chunkIndex = Math.floor(frameIndex / this.opts.chunkSize);
		const worker = this.workers[chunkIndex % this.workers.length]!;
		this.post(
			worker,
			{
				type: 'encode',
				frame,
				frameIndex,
				keyFrame: frameIndex % this.opts.chunkSize === 0,
			},
			[frame],
		);
	}

	/** Flushes all workers and waits until every packet has been emitted in order. */
	async flush(): Promise<void> {
		this.throwIfFailed();
		await new Promise<void>((resolve, reject) => {
			this.flushWaiter = resolve;
			this.failureWaiters.push(reject);
			for (const worker of this.workers) this.post(worker, { type: 'flush' });
		});
		this.throwIfFailed();
		if (this.pending.size > 0 || this.inFlight > 0) {
			throw new Error(
				`Encode pool finished with ${this.inFlight} frames unaccounted for`,
			);
		}
	}

	dispose(): void {
		for (const worker of this.workers) worker.terminate();
		this.workers = [];
		this.pending.clear();
	}

	private post(
		worker: Worker,
		msg: EncodeWorkerRequest,
		transfer?: Transferable[],
	) {
		worker.postMessage(msg, transfer ?? []);
	}

	private handleMessage(msg: EncodeWorkerResponse) {
		if (msg.type === 'packet') {
			this.inFlight--;
			this.slotWaiters.shift()?.();
			this.pending.set(msg.frameIndex, {
				data: new Uint8Array(msg.data),
				type: msg.packetType,
				timestamp: msg.timestamp / 1e6,
				duration: msg.duration / 1e6,
				decoderConfig: msg.decoderConfig,
			});
			while (this.pending.has(this.nextEmitIndex)) {
				const packet = this.pending.get(this.nextEmitIndex)!;
				this.pending.delete(this.nextEmitIndex);
				this.nextEmitIndex++;
				this.opts.onPacket(packet);
			}
			this.checkFlushed();
		} else if (msg.type === 'flushed') {
			this.flushedCount++;
			this.checkFlushed();
		} else if (msg.type === 'error') {
			this.fail(new Error(msg.message));
		}
	}

	private checkFlushed() {
		if (
			this.flushWaiter &&
			this.flushedCount === this.workers.length &&
			this.inFlight === 0
		) {
			this.flushWaiter();
			this.flushWaiter = null;
		}
	}

	private fail(err: Error) {
		if (this.failure) return;
		this.failure = err;
		for (const reject of this.failureWaiters) reject(err);
		this.failureWaiters = [];
		this.slotWaiters = [];
	}

	private throwIfFailed() {
		if (this.failure) throw this.failure;
	}
}
