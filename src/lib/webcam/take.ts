import type { StreamTargetChunk } from "mediabunny";
import { openOutputBuffer } from "../recorder";
import { drawShaped, type CameraShape } from "./shape";

/** A webcam take: the camera's frames straight into a WebM, in real time. mediabunny
 * writes a proper header and cues, unlike MediaRecorder, whose output reports no duration. */
export interface Take {
	/** Seconds captured so far, for the panel's counter. */
	readonly elapsed: number;
	stop(): Promise<File>;
	/** Drop the take without a file. */
	cancel(): void;
}

const TAKE_BITRATE = 8_000_000;

/** `size` for a track that may not report its own, like a canvas's. */
export async function startTake(
	stream: MediaStream,
	size?: { width: number; height: number },
): Promise<Take> {
	const mb = await import("mediabunny");
	const track = stream.getVideoTracks()[0];
	if (!track) throw new Error("The camera gave no video.");
	const settings = track.getSettings();
	const width = size?.width ?? settings.width ?? 1280;
	const height = size?.height ?? settings.height ?? 720;
	const format = new mb.WebMOutputFormat();
	const containerCodecs = format.getSupportedVideoCodecs();
	const codec = await mb.getFirstEncodableVideoCodec(
		(["vp9", "vp8", "av1"] as const).filter((c) => containerCodecs.includes(c)),
		{ width, height, bitrate: TAKE_BITRATE },
	);
	if (!codec) throw new Error("This browser can't encode WEBM video.");

	// On disk where the browser allows: a long take would otherwise grow in memory.
	const buffer = await openOutputBuffer("take");
	const target = new mb.StreamTarget(
		new WritableStream<StreamTargetChunk>({
			write(chunk) {
				return buffer.write(chunk.data, chunk.position);
			},
		}),
		{ chunked: true },
	);
	const output = new mb.Output({ format, target });
	const source = new mb.MediaStreamVideoTrackSource(track, {
		codec,
		bitrate: TAKE_BITRATE,
		latencyMode: "realtime",
	});
	output.addVideoTrack(source);
	await output.start();
	const startedAt = performance.now();
	let done = false;

	// A dying source (camera unplugged, encoder failure) surfaces here; the
	// stop() below then finds the output already errored.
	let sourceError: unknown = null;
	source.errorPromise.catch((e) => (sourceError = e));

	return {
		get elapsed() {
			return (performance.now() - startedAt) / 1000;
		},
		async stop() {
			if (done) throw new Error("Take already ended");
			done = true;
			if (sourceError) {
				buffer.discard();
				throw sourceError;
			}
			source.close();
			await output.finalize();
			const blob = await buffer.toBlob("video/webm");
			if (blob.size === 0) throw new Error("The take came out empty.");
			return new File([blob], `take-${Date.now()}.webm`, {
				type: "video/webm",
			});
		},
		cancel() {
			if (done) return;
			done = true;
			source.close();
			void output.cancel().finally(() => buffer.discard());
		},
	};
}

/** One still off the camera, shaped, as a PNG file. */
export async function snapStill(
	video: HTMLVideoElement,
	shape: CameraShape,
	name = `snap-${Date.now()}.png`,
): Promise<File | null> {
	const canvas = document.createElement("canvas");
	if (!drawShaped(canvas, canvas.getContext("2d")!, video, shape)) return null;
	const blob = await new Promise<Blob | null>((r) =>
		canvas.toBlob(r, "image/png"),
	);
	return blob ? new File([blob], name, { type: "image/png" }) : null;
}
