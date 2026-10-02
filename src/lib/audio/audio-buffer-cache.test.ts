import { expect, mock, test } from "bun:test";

let decodes = 0;
mock.module("./offline-audio", () => ({
	decodeAudioFile: async () => ({ id: ++decodes }) as unknown as AudioBuffer,
}));
const { getDecodedAudioBuffer } = await import("./audio-buffer-cache");
const { trackToFile } = await import("./track-library");

const track = {
	id: "t1",
	name: "song.wav",
	blob: new Blob(["pcm"], { type: "audio/wav" }),
	addedAt: 42,
};

test("rebuilding a stored song hits the cache instead of decoding again", async () => {
	const before = decodes;
	const a = await getDecodedAudioBuffer(trackToFile(track));
	const b = await getDecodedAudioBuffer(trackToFile(track));
	expect(a).toBe(b);
	expect(decodes - before).toBe(1);
});

test("only the most recent decodes are held", async () => {
	const files = [1, 2, 3, 4].map(
		(n) => new File([`x${n}`], `${n}.wav`, { lastModified: n }),
	);
	for (const f of files) await getDecodedAudioBuffer(f);
	const before = decodes;
	await getDecodedAudioBuffer(files[3]);
	expect(decodes).toBe(before);
	await getDecodedAudioBuffer(files[0]);
	expect(decodes).toBe(before + 1);
});
