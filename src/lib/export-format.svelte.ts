import {
	DEFAULT_EXPORT_QUALITY,
	type ExportQuality,
	isExportQuality,
} from "./export-quality";
import { readRaw, writeRaw } from "./storage";

export type VideoContainer = "webm" | "mp4";

const KEY = "openmosh-export-format";
const QUALITY_KEY = "openmosh-export-quality";

const storedQuality = readRaw(QUALITY_KEY);
let quality = $state<ExportQuality>(
	isExportQuality(storedQuality) ? storedQuality : DEFAULT_EXPORT_QUALITY,
);

export function getExportQuality(): ExportQuality {
	return quality;
}

export function setExportQuality(value: ExportQuality) {
	quality = value;
	writeRaw(QUALITY_KEY, value);
}

// Phones default to MP4: the iPhone Photos app can't play WebM.
const stored = readRaw(KEY);
let format = $state<VideoContainer>(
	stored === "mp4" || stored === "webm"
		? stored
		: globalThis.matchMedia?.("(pointer: coarse)").matches
			? "mp4"
			: "webm",
);
/** Null until probed. */
let mp4Supported = $state<boolean | null>(null);
let probing: Promise<boolean> | null = null;

export function getExportFormat(): VideoContainer {
	return mp4Supported === false ? "webm" : format;
}

export function setExportFormat(value: VideoContainer) {
	format = value;
	writeRaw(KEY, value);
}

export function isMp4Supported(): boolean | null {
	return mp4Supported;
}

/** H.264 is what MP4 players expect; without it the MP4 option stays off. */
export function probeMp4(): Promise<boolean> {
	probing ??= (async () => {
		if (typeof VideoEncoder === "undefined") return false;
		for (const codec of ["avc1.640028", "avc1.42001f"]) {
			try {
				const { supported } = await VideoEncoder.isConfigSupported({
					codec,
					width: 1280,
					height: 720,
					bitrate: 4_000_000,
				});
				if (supported) return true;
			} catch {
				// Unknown codec strings throw on some browsers.
			}
		}
		return false;
	})().then((ok) => (mp4Supported = ok));
	return probing;
}
