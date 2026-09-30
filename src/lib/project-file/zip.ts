/** A zip writer and reader with no dependency. Entries are stored, not deflated: the
 * media inside is already compressed, and storing lets an archive be built from the
 * media blobs without copying them through memory. */

const LOCAL_SIG = 0x04034b50;
const CENTRAL_SIG = 0x02014b50;
const EOCD_SIG = 0x06054b50;
const ZIP64_EOCD_SIG = 0x06064b50;
const ZIP64_LOCATOR_SIG = 0x07064b50;
const ZIP64_EXTRA_ID = 0x0001;
const U32_MAX = 0xffffffff;
const U16_MAX = 0xffff;
/** Names are UTF-8; without this flag a reader guesses the local codepage. */
const UTF8_FLAG = 0x0800;
const STORE = 0;
const VERSION_STORE = 20;
const VERSION_ZIP64 = 45;
/** The end record is 22 bytes plus a comment of at most 64 KB. */
const EOCD_MAX = 22 + 0xffff;

const CRC_TABLE = (() => {
	const table = new Uint32Array(256);
	for (let n = 0; n < 256; n++) {
		let c = n;
		for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
		table[n] = c >>> 0;
	}
	return table;
})();

function crc32Update(crc: number, bytes: Uint8Array): number {
	for (let i = 0; i < bytes.length; i++) {
		crc = (crc >>> 8) ^ CRC_TABLE[(crc ^ bytes[i]) & 0xff];
	}
	return crc;
}

/** Checksum a blob by streaming it once, so a 2 GB file is never held whole. */
async function crc32Of(blob: Blob): Promise<number> {
	if (typeof blob.stream !== "function") {
		const bytes = new Uint8Array(await blob.arrayBuffer());
		return (crc32Update(0xffffffff, bytes) ^ 0xffffffff) >>> 0;
	}
	const reader = blob.stream().getReader();
	let crc = 0xffffffff;
	try {
		for (;;) {
			const { done, value } = await reader.read();
			if (done) break;
			crc = crc32Update(crc, value);
		}
	} finally {
		reader.releaseLock();
	}
	return (crc ^ 0xffffffff) >>> 0;
}

function writeU16(view: DataView, at: number, value: number): void {
	view.setUint16(at, value, true);
}

function writeU32(view: DataView, at: number, value: number): void {
	view.setUint32(at, value >>> 0, true);
}

/** Little-endian 64-bit, split so a value past 2^32 still lands. */
function writeU64(view: DataView, at: number, value: number): void {
	view.setUint32(at, value >>> 0, true);
	view.setUint32(at + 4, Math.floor(value / 0x100000000), true);
}

function readU64(view: DataView, at: number): number {
	return view.getUint32(at, true) + view.getUint32(at + 4, true) * 0x100000000;
}

/** MS-DOS packed date and time, the only stamp a zip header carries. */
function dosStamp(date: Date): { time: number; date: number } {
	const time =
		((date.getHours() & 0x1f) << 11) |
		((date.getMinutes() & 0x3f) << 5) |
		((date.getSeconds() >> 1) & 0x1f);
	const day =
		(((date.getFullYear() - 1980) & 0x7f) << 9) |
		(((date.getMonth() + 1) & 0x0f) << 5) |
		(date.getDate() & 0x1f);
	return { time, date: day };
}

export interface ZipEntryInput {
	name: string;
	blob: Blob;
	/** Declared size; defaults to the blob's. Tests fake it to reach the zip64 path. */
	size?: number;
}

interface PreparedEntry {
	nameBytes: Uint8Array;
	blob: Blob;
	size: number;
	crc: number;
	offset: number;
	zip64: boolean;
}

function localHeader(entry: PreparedEntry, stamp: ReturnType<typeof dosStamp>) {
	const extraLen = entry.zip64 ? 20 : 0;
	const bytes = new Uint8Array(30 + entry.nameBytes.length + extraLen);
	const view = new DataView(bytes.buffer);
	writeU32(view, 0, LOCAL_SIG);
	writeU16(view, 4, entry.zip64 ? VERSION_ZIP64 : VERSION_STORE);
	writeU16(view, 6, UTF8_FLAG);
	writeU16(view, 8, STORE);
	writeU16(view, 10, stamp.time);
	writeU16(view, 12, stamp.date);
	writeU32(view, 14, entry.crc);
	writeU32(view, 18, entry.zip64 ? U32_MAX : entry.size);
	writeU32(view, 22, entry.zip64 ? U32_MAX : entry.size);
	writeU16(view, 26, entry.nameBytes.length);
	writeU16(view, 28, extraLen);
	bytes.set(entry.nameBytes, 30);
	if (entry.zip64) {
		const at = 30 + entry.nameBytes.length;
		writeU16(view, at, ZIP64_EXTRA_ID);
		writeU16(view, at + 2, 16);
		writeU64(view, at + 4, entry.size);
		writeU64(view, at + 12, entry.size);
	}
	return bytes;
}

function centralHeader(
	entry: PreparedEntry,
	stamp: ReturnType<typeof dosStamp>,
) {
	const needSize = entry.size >= U32_MAX;
	const needOffset = entry.offset >= U32_MAX;
	const dataLen = (needSize ? 16 : 0) + (needOffset ? 8 : 0);
	const extraLen = dataLen > 0 ? dataLen + 4 : 0;
	const bytes = new Uint8Array(46 + entry.nameBytes.length + extraLen);
	const view = new DataView(bytes.buffer);
	writeU32(view, 0, CENTRAL_SIG);
	writeU16(view, 4, VERSION_ZIP64);
	writeU16(view, 6, extraLen > 0 ? VERSION_ZIP64 : VERSION_STORE);
	writeU16(view, 8, UTF8_FLAG);
	writeU16(view, 10, STORE);
	writeU16(view, 12, stamp.time);
	writeU16(view, 14, stamp.date);
	writeU32(view, 16, entry.crc);
	writeU32(view, 20, needSize ? U32_MAX : entry.size);
	writeU32(view, 24, needSize ? U32_MAX : entry.size);
	writeU16(view, 28, entry.nameBytes.length);
	writeU16(view, 30, extraLen);
	writeU16(view, 32, 0);
	writeU16(view, 34, 0);
	writeU16(view, 36, 0);
	writeU32(view, 38, 0);
	writeU32(view, 42, needOffset ? U32_MAX : entry.offset);
	bytes.set(entry.nameBytes, 46);
	if (extraLen > 0) {
		let at = 46 + entry.nameBytes.length;
		writeU16(view, at, ZIP64_EXTRA_ID);
		writeU16(view, at + 2, dataLen);
		at += 4;
		if (needSize) {
			writeU64(view, at, entry.size);
			writeU64(view, at + 8, entry.size);
			at += 16;
		}
		if (needOffset) writeU64(view, at, entry.offset);
	}
	return bytes;
}

/** The end-of-central-directory records, in the zip64 form when anything overflows. */
function endRecords(count: number, cdOffset: number, cdSize: number) {
	const zip64 = count > U16_MAX || cdOffset >= U32_MAX || cdSize >= U32_MAX;
	if (!zip64) {
		const bytes = new Uint8Array(22);
		const view = new DataView(bytes.buffer);
		writeU32(view, 0, EOCD_SIG);
		writeU16(view, 4, 0);
		writeU16(view, 6, 0);
		writeU16(view, 8, count);
		writeU16(view, 10, count);
		writeU32(view, 12, cdSize);
		writeU32(view, 16, cdOffset);
		writeU16(view, 20, 0);
		return bytes;
	}

	const record = new Uint8Array(56);
	const rv = new DataView(record.buffer);
	writeU32(rv, 0, ZIP64_EOCD_SIG);
	writeU64(rv, 4, 44);
	writeU16(rv, 12, VERSION_ZIP64);
	writeU16(rv, 14, VERSION_ZIP64);
	writeU32(rv, 16, 0);
	writeU32(rv, 20, 0);
	writeU64(rv, 24, count);
	writeU64(rv, 32, count);
	writeU64(rv, 40, cdSize);
	writeU64(rv, 48, cdOffset);

	const locator = new Uint8Array(20);
	const lv = new DataView(locator.buffer);
	writeU32(lv, 0, ZIP64_LOCATOR_SIG);
	writeU32(lv, 4, 0);
	writeU64(lv, 8, cdOffset + cdSize);
	writeU32(lv, 16, 1);

	const eocd = new Uint8Array(22);
	const ev = new DataView(eocd.buffer);
	writeU32(ev, 0, EOCD_SIG);
	writeU16(ev, 4, 0);
	writeU16(ev, 6, 0);
	writeU16(ev, 8, U16_MAX);
	writeU16(ev, 10, U16_MAX);
	writeU32(ev, 12, U32_MAX);
	writeU32(ev, 16, U32_MAX);
	writeU16(ev, 20, 0);

	const out = new Uint8Array(record.length + locator.length + eocd.length);
	out.set(record, 0);
	out.set(locator, record.length);
	out.set(eocd, record.length + locator.length);
	return out;
}

/** Build the archive. Header bytes and the media blobs go into one Blob, so the
 * media is never copied through memory. */
export async function writeZip(entries: ZipEntryInput[]): Promise<Blob> {
	const encoder = new TextEncoder();
	const stamp = dosStamp(new Date());
	const parts: BlobPart[] = [];
	const prepared: PreparedEntry[] = [];
	let offset = 0;
	for (const entry of entries) {
		const nameBytes = encoder.encode(entry.name);
		const size = entry.size ?? entry.blob.size;
		const crc = await crc32Of(entry.blob);
		const zip64 = size >= U32_MAX || offset >= U32_MAX;
		const item: PreparedEntry = {
			nameBytes,
			blob: entry.blob,
			size,
			crc,
			offset,
			zip64,
		};
		prepared.push(item);
		parts.push(localHeader(item, stamp));
		parts.push(entry.blob);
		offset += 30 + nameBytes.length + (zip64 ? 20 : 0) + size;
	}

	const cdParts: BlobPart[] = [];
	let cdSize = 0;
	for (const item of prepared) {
		const header = centralHeader(item, stamp);
		cdParts.push(header);
		cdSize += header.length;
	}
	const end = endRecords(prepared.length, offset, cdSize);
	return new Blob([...parts, ...cdParts, end]);
}

export interface ReadZipEntry {
	name: string;
	/** A view into the source file; nothing is copied. */
	blob: Blob;
	size: number;
}

/** The EOCD sits at the end, after an optional comment; scan back for it. */
function findEocd(tail: Uint8Array): number {
	for (let i = tail.length - 22; i >= 0; i--) {
		if (
			tail[i] === 0x50 &&
			tail[i + 1] === 0x4b &&
			tail[i + 2] === 0x05 &&
			tail[i + 3] === 0x06
		) {
			const commentLen = tail[i + 20] | (tail[i + 21] << 8);
			if (i + 22 + commentLen === tail.length) return i;
		}
	}
	return -1;
}

/** The 8-byte values a zip64 extra field carries, in the order the spec fixes. */
function zip64Values(extra: Uint8Array): number[] {
	let at = 0;
	while (at + 4 <= extra.length) {
		const id = extra[at] | (extra[at + 1] << 8);
		const len = extra[at + 2] | (extra[at + 3] << 8);
		if (id === ZIP64_EXTRA_ID) {
			const view = new DataView(extra.buffer, extra.byteOffset + at + 4, len);
			const values: number[] = [];
			for (let q = 0; q + 8 <= len; q += 8) values.push(readU64(view, q));
			return values;
		}
		at += 4 + len;
	}
	return [];
}

/** Parse the table of contents and hand back each entry as a slice of the file. */
export async function readZip(file: Blob): Promise<ReadZipEntry[]> {
	if (file.size < 22) throw new Error("Not a zip file");
	const tailLen = Math.min(file.size, EOCD_MAX);
	const tail = new Uint8Array(
		await file.slice(file.size - tailLen).arrayBuffer(),
	);
	const eocdAt = findEocd(tail);
	if (eocdAt < 0) throw new Error("Not a zip file");
	const eocd = new DataView(tail.buffer, tail.byteOffset + eocdAt);

	let count = eocd.getUint16(10, true);
	let cdSize = eocd.getUint32(12, true);
	let cdOffset = eocd.getUint32(16, true);

	if (count === U16_MAX || cdSize === U32_MAX || cdOffset === U32_MAX) {
		const locatorAt = eocdAt - 20;
		if (locatorAt < 0) throw new Error("Corrupt zip");
		const locator = new DataView(tail.buffer, tail.byteOffset + locatorAt);
		if (locator.getUint32(0, true) !== ZIP64_LOCATOR_SIG)
			throw new Error("Corrupt zip");
		const recordAt = readU64(locator, 8);
		const record = new Uint8Array(
			await file.slice(recordAt, recordAt + 56).arrayBuffer(),
		);
		if (record.length < 56) throw new Error("Corrupt zip");
		const rv = new DataView(record.buffer);
		if (rv.getUint32(0, true) !== ZIP64_EOCD_SIG)
			throw new Error("Corrupt zip");
		count = readU64(rv, 32);
		cdSize = readU64(rv, 40);
		cdOffset = readU64(rv, 48);
	}

	if (cdOffset + cdSize > file.size) throw new Error("Corrupt zip");
	const cd = new Uint8Array(
		await file.slice(cdOffset, cdOffset + cdSize).arrayBuffer(),
	);
	const decoder = new TextDecoder();
	const entries: ReadZipEntry[] = [];
	let at = 0;
	for (let i = 0; i < count; i++) {
		if (at + 46 > cd.length) throw new Error("Corrupt zip");
		const view = new DataView(cd.buffer, cd.byteOffset + at);
		if (view.getUint32(0, true) !== CENTRAL_SIG) throw new Error("Corrupt zip");
		if (view.getUint16(10, true) !== STORE)
			throw new Error("Unsupported compression in zip");
		let compSize = view.getUint32(20, true);
		let uncompSize = view.getUint32(24, true);
		const nameLen = view.getUint16(28, true);
		const extraLen = view.getUint16(30, true);
		const commentLen = view.getUint16(32, true);
		let localOffset = view.getUint32(42, true);
		const name = decoder.decode(cd.subarray(at + 46, at + 46 + nameLen));

		if (
			compSize === U32_MAX ||
			uncompSize === U32_MAX ||
			localOffset === U32_MAX
		) {
			const extra = cd.subarray(
				at + 46 + nameLen,
				at + 46 + nameLen + extraLen,
			);
			const values = zip64Values(extra);
			let v = 0;
			if (uncompSize === U32_MAX) uncompSize = values[v++] ?? 0;
			if (compSize === U32_MAX) compSize = values[v++] ?? 0;
			if (localOffset === U32_MAX) localOffset = values[v++] ?? 0;
		}

		if (localOffset + 30 > file.size) throw new Error("Corrupt zip");
		const local = new Uint8Array(
			await file.slice(localOffset, localOffset + 30).arrayBuffer(),
		);
		const lv = new DataView(local.buffer);
		if (lv.getUint32(0, true) !== LOCAL_SIG) throw new Error("Corrupt zip");
		const dataStart =
			localOffset + 30 + lv.getUint16(26, true) + lv.getUint16(28, true);
		if (dataStart + compSize > file.size) throw new Error("Corrupt zip");
		entries.push({
			name,
			blob: file.slice(dataStart, dataStart + compSize),
			size: uncompSize,
		});
		at += 46 + nameLen + extraLen + commentLen;
	}
	return entries;
}
