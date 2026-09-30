import { estimateTempo } from "../audio/tempo";

export type BpmWorkerRequest = {
	id: number;
	samples: Float32Array;
	sampleRate: number;
};

export type BpmWorkerResponse =
	| { id: number; ok: true; bpm: number; offset: number }
	| { id: number; ok: false; error: string };

self.onmessage = (e: MessageEvent<BpmWorkerRequest>) => {
	try {
		const { id, samples, sampleRate } = e.data;
		const { bpm, offset } = estimateTempo(samples, sampleRate);
		const response: BpmWorkerResponse = { id, ok: true, bpm, offset };
		self.postMessage(response);
	} catch (err) {
		const response: BpmWorkerResponse = {
			id: e.data.id,
			ok: false,
			error: String(err),
		};
		self.postMessage(response);
	}
};
