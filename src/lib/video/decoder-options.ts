import type { VideoSinkDecoderOptions } from "mediabunny";

/** GPU decoders take 4:2:0 frames in even sizes only, and Chrome decodes an
 * odd-sized track to nothing on one, so such a track decodes in software. */
export function decoderOptions(track: {
	codedWidth: number;
	codedHeight: number;
}): VideoSinkDecoderOptions {
	return track.codedWidth % 2 || track.codedHeight % 2
		? { hardwareAcceleration: "prefer-software" }
		: {};
}
