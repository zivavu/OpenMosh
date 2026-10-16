/** Browsers hand some files over with no MIME type, depending on the OS's own table.
 * Every intake check reads `file.type`, so an untyped file gets one from its name. */

const TYPE_BY_EXTENSION: Record<string, string> = {
	png: "image/png",
	jpg: "image/jpeg",
	jpeg: "image/jpeg",
	webp: "image/webp",
	avif: "image/avif",
	gif: "image/gif",
	heic: "image/heic",
	heif: "image/heif",
	svg: "image/svg+xml",
	mp4: "video/mp4",
	m4v: "video/mp4",
	webm: "video/webm",
	mov: "video/quicktime",
	mp3: "audio/mpeg",
	wav: "audio/wav",
	ogg: "audio/ogg",
	flac: "audio/flac",
	m4a: "audio/mp4",
	aac: "audio/aac",
};

/** The MIME type a media file's name implies, or "" for a name we don't know. */
export function mediaTypeForName(name: string): string {
	const dot = name.lastIndexOf(".");
	if (dot < 0) return "";
	return TYPE_BY_EXTENSION[name.slice(dot + 1).toLowerCase()] ?? "";
}

/** The file as is when it has a type; else the same bytes, name and timestamp
 * under the type its name implies, so its source id doesn't change. */
export function withMediaType(file: File): File {
	if (file.type) return file;
	const type = mediaTypeForName(file.name);
	if (!type) return file;
	return new File([file], file.name, { type, lastModified: file.lastModified });
}
