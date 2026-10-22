import type { VideoSample } from "mediabunny";

/** The sample as an upright VideoFrame; closes the sample. Phones store portrait
 * clips sideways, with rotation metadata. */
export async function uprightFrame(sample: VideoSample): Promise<VideoFrame> {
	try {
		if (sample.rotation === 0 && !sample.flip) return sample.toVideoFrame();
		const upright = await sample.transform({});
		try {
			return upright.toVideoFrame();
		} finally {
			upright.close();
		}
	} finally {
		sample.close();
	}
}
