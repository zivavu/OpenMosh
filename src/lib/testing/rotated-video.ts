/** A one-second MP4 stored the way phones store portrait clips: coded landscape with
 * 90° rotation metadata. The coded left half is `top`, so upright it reads top over bottom.
 * Built in the browser for the e2e specs; Node has no encoder. */
export async function rotatedMp4(
	top: string,
	bottom: string,
): Promise<number[]> {
	const {
		BufferTarget,
		CanvasSource,
		getFirstEncodableVideoCodec,
		Mp4OutputFormat,
		Output,
		QUALITY_HIGH,
	} = await import("mediabunny");
	const size = { width: 128, height: 64 };
	const codec = await getFirstEncodableVideoCodec(["vp9", "vp8", "av1"], size);
	if (!codec) throw new Error("no encodable codec");
	const canvas = new OffscreenCanvas(size.width, size.height);
	const ctx = canvas.getContext("2d")!;
	ctx.fillStyle = top;
	ctx.fillRect(0, 0, size.width / 2, size.height);
	ctx.fillStyle = bottom;
	ctx.fillRect(size.width / 2, 0, size.width / 2, size.height);
	const target = new BufferTarget();
	const output = new Output({ format: new Mp4OutputFormat(), target });
	const source = new CanvasSource(canvas, { codec, bitrate: QUALITY_HIGH });
	output.addVideoTrack(source, { rotation: 90 });
	await output.start();
	for (let i = 0; i < 10; i++) await source.add(i / 10, 1 / 10);
	await output.finalize();
	return [...new Uint8Array(target.buffer!)];
}
