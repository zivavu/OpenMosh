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

export async function startTake(stream: MediaStream): Promise<Take> {
	const mb = await import("mediabunny");
	const track = stream.getVideoTracks()[0];
	if (!track) throw new Error("The camera gave no video.");
	const { width = 1280, height = 720 } = track.getSettings();
	const format = new mb.WebMOutputFormat();
	const containerCodecs = format.getSupportedVideoCodecs();
	const codec = await mb.getFirstEncodableVideoCodec(
		(["vp9", "vp8", "av1"] as const).filter((c) => containerCodecs.includes(c)),
		{ width, height, bitrate: TAKE_BITRATE },
	);
	if (!codec) throw new Error("This browser can't encode WEBM video.");

	const target = new mb.BufferTarget();
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
			if (sourceError) throw sourceError;
			source.close();
			await output.finalize();
			const buffer = target.buffer;
			if (!buffer) throw new Error("The take came out empty.");
			return new File([buffer], `take-${Date.now()}.webm`, {
				type: "video/webm",
			});
		},
		cancel() {
			if (done) return;
			done = true;
			source.close();
			void output.cancel();
		},
	};
}

/** One still off the camera, as a PNG file. */
export async function snapStill(
	video: HTMLVideoElement,
	name = `snap-${Date.now()}.png`,
): Promise<File | null> {
	const w = video.videoWidth;
	const h = video.videoHeight;
	if (!w || !h) return null;
	const canvas = document.createElement("canvas");
	canvas.width = w;
	canvas.height = h;
	canvas.getContext("2d")!.drawImage(video, 0, 0, w, h);
	const blob = await new Promise<Blob | null>((r) =>
		canvas.toBlob(r, "image/png"),
	);
	return blob ? new File([blob], name, { type: "image/png" }) : null;
}
