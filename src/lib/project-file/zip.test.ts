import { describe, expect, it } from "bun:test";
import { readZip, writeZip, type ZipEntryInput } from "./zip";

function bytes(text: string): Uint8Array {
	return new TextEncoder().encode(text);
}

async function blobBytes(blob: Blob): Promise<Uint8Array> {
	return new Uint8Array(await blob.arrayBuffer());
}

/** Where a 4-byte little-endian signature sits in the archive, or -1. */
function findSignature(data: Uint8Array, signature: number): number {
	const a = signature & 0xff;
	const b = (signature >>> 8) & 0xff;
	const c = (signature >>> 16) & 0xff;
	const d = (signature >>> 24) & 0xff;
	for (let i = 0; i + 4 <= data.length; i++) {
		if (
			data[i] === a &&
			data[i + 1] === b &&
			data[i + 2] === c &&
			data[i + 3] === d
		)
			return i;
	}
	return -1;
}

describe("zip round trip", () => {
	it("reads back every entry's name and bytes", async () => {
		const entries: ZipEntryInput[] = [
			{ name: "project.json", blob: new Blob([bytes('{"a":1}')]) },
			{ name: "media/0.png", blob: new Blob([bytes("PNGDATA")]) },
			{ name: "songs/0.wav", blob: new Blob([bytes("WAVDATA")]) },
		];
		const zip = await writeZip(entries);
		const read = await readZip(zip);
		expect(read.map((e) => e.name)).toEqual([
			"project.json",
			"media/0.png",
			"songs/0.wav",
		]);
		expect(await read[0].blob.text()).toBe('{"a":1}');
		expect(await read[1].blob.text()).toBe("PNGDATA");
		expect(await read[2].blob.text()).toBe("WAVDATA");
		expect(read[1].size).toBe(7);
	});

	it("keeps empty entries", async () => {
		const zip = await writeZip([
			{ name: "empty.txt", blob: new Blob([]) },
			{ name: "full.txt", blob: new Blob([bytes("x")]) },
		]);
		const read = await readZip(zip);
		expect(read.map((e) => e.size)).toEqual([0, 1]);
		expect(await read[0].blob.text()).toBe("");
	});

	it("keeps non-ASCII names", async () => {
		const zip = await writeZip([
			{ name: "media/日本語 – clip.png", blob: new Blob([bytes("x")]) },
		]);
		const read = await readZip(zip);
		expect(read[0].name).toBe("media/日本語 – clip.png");
	});

	it("reads an archive with no entries", async () => {
		const zip = await writeZip([]);
		expect(await readZip(zip)).toEqual([]);
	});
});

describe("zip64", () => {
	it("writes the zip64 extra field and end record for a huge declared size", async () => {
		const zip = await writeZip([
			{ name: "big.bin", blob: new Blob([bytes("small")]), size: 0x100000000 },
		]);
		const data = await blobBytes(zip);
		// The zip64 end-of-central-directory record and its locator.
		expect(findSignature(data, 0x06064b50)).toBeGreaterThan(-1);
		expect(findSignature(data, 0x07064b50)).toBeGreaterThan(-1);
		// The extra field id 0x0001 appears in both the local and central headers.
		const extra = findSignature(data, 0x0001);
		expect(extra).toBeGreaterThan(-1);
	});

	it("stays on the plain format for small entries", async () => {
		const zip = await writeZip([
			{ name: "a.txt", blob: new Blob([bytes("a")]) },
		]);
		const data = await blobBytes(zip);
		expect(findSignature(data, 0x06064b50)).toBe(-1);
	});
});

describe("corrupt archives", () => {
	it("rejects a file too short to be a zip", async () => {
		await expect(readZip(new Blob([bytes("nope")]))).rejects.toThrow(
			"Not a zip file",
		);
	});

	it("rejects bytes with no end record", async () => {
		const junk = new Uint8Array(64).fill(7);
		await expect(readZip(new Blob([junk]))).rejects.toThrow("Not a zip file");
	});

	it("rejects a damaged central directory", async () => {
		const zip = await writeZip([
			{ name: "a.txt", blob: new Blob([bytes("hello")]) },
		]);
		const data = await blobBytes(zip);
		// Break the central header's signature; the EOCD still points at it.
		const cd = findSignature(data, 0x02014b50);
		expect(cd).toBeGreaterThan(-1);
		data[cd] = 0;
		await expect(readZip(new Blob([data]))).rejects.toThrow("Corrupt zip");
	});
});
