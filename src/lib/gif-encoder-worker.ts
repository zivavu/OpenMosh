import { applyPalette, GIFEncoder, quantize } from 'gifenc';

type InitMessage = { type: 'init'; width: number; height: number; delay: number };
type FrameMessage = {
	type: 'frame';
	width: number;
	height: number;
	delay: number;
	rgba: ArrayBuffer;
};
type FinishMessage = { type: 'finish' };
type WorkerMessage = InitMessage | FrameMessage | FinishMessage;

let gif: ReturnType<typeof GIFEncoder> | null = null;

self.onmessage = (e: MessageEvent<WorkerMessage>) => {
	const msg = e.data;
	switch (msg.type) {
		case 'init': {
			gif = GIFEncoder();
			break;
		}
		case 'frame': {
			if (!gif) throw new Error('GIF worker: init before frame');
			const rgba = new Uint8ClampedArray(msg.rgba);
			const palette = quantize(rgba, 256);
			const index = applyPalette(rgba, palette);
			gif.writeFrame(index, msg.width, msg.height, {
				palette,
				delay: msg.delay,
			});
			self.postMessage({ type: 'frame-done' });
			break;
		}
		case 'finish': {
			if (!gif) throw new Error('GIF worker: init before finish');
			gif.finish();
			const bytes = gif.bytes();
			const buffer = bytes.buffer;
			self.postMessage({ type: 'done', buffer }, [buffer]);
			gif = null;
			break;
		}
	}
};
