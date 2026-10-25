/** Small frames spread evenly across a video, so its timeline clips show what plays
 * where instead of one frame tiled. */

import { drawThumb } from "../slideshow/video-sampler";
import { openPlayableVideo } from "./decode";
import { uprightFrame } from "./upright";

const FRAMES_PER_SECOND = 2;
const MAX_FRAMES = 60;
const FRAME_SIZE = 64;

export function filmstripFrameCount(duration: number): number {
	if (!(duration > 0)) return 0;
	return Math.min(
		MAX_FRAMES,
		Math.max(1, Math.ceil(duration * FRAMES_PER_SECOND)),
	);
}

/** Frame `i` is taken from the middle of its slice of the video. */
export function filmstripFrameTime(
	index: number,
	count: number,
	duration: number,
): number {
	return ((index + 0.5) / count) * duration;
}

/** The frame showing source time `time`, which wraps like the sampler does. */
export function filmstripIndexAt(
	time: number,
	count: number,
	duration: number,
): number {
	if (count <= 0 || !(duration > 0)) return 0;
	const wrapped = ((time % duration) + duration) % duration;
	return Math.min(count - 1, Math.floor((wrapped / duration) * count));
}

/** One decode at a time: the preview's own decoders come first. */
let queue: Promise<unknown> = Promise.resolve();

/** Decodes each frame in turn and hands it over as it lands. Stops once `wanted`
 * turns false, e.g. when the source left the pool. */
export function decodeFilmstrip(
	file: File,
	duration: number,
	onFrame: (index: number, frame: Blob) => void,
	wanted: () => boolean,
): Promise<void> {
	const run = queue.then(() =>
		wanted() ? decode(file, duration, onFrame, wanted) : undefined,
	);
	queue = run.catch(() => {});
	return run;
}

async function decode(
	file: File,
	duration: number,
	onFrame: (index: number, frame: Blob) => void,
	wanted: () => boolean,
) {
	const opened = await openPlayableVideo(file);
	if (!opened) return;
	try {
		const count = filmstripFrameCount(duration);
		// A timestamp before the first frame comes back null.
		const first = await opened.track.getFirstTimestamp();
		const times = Array.from({ length: count }, (_, i) =>
			Math.max(first, filmstripFrameTime(i, count, duration)),
		);
		let index = 0;
		for await (const sample of opened.sink.samplesAtTimestamps(times)) {
			const i = index++;
			if (!wanted()) {
				sample?.close();
				break;
			}
			if (!sample) continue;
			const frame = await uprightFrame(sample);
			const blob = await drawThumb(frame, FRAME_SIZE).finally(() =>
				frame.close(),
			);
			if (blob && wanted()) onFrame(i, blob);
		}
	} catch {
		// Frames missed here fall back to the source's thumbnail.
	} finally {
		opened.input.dispose();
	}
}
