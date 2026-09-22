/** Camera access shared by every mode's webcam entry. */

export interface CameraInfo {
	deviceId: string;
	label: string;
}

/** Cameras the browser will name; only after a grant, so ask once first. */
export async function listCameras(): Promise<CameraInfo[]> {
	if (!navigator.mediaDevices?.enumerateDevices) return [];
	const all = await navigator.mediaDevices.enumerateDevices();
	return all
		.filter((d) => d.kind === "videoinput")
		.map((d, i) => ({
			deviceId: d.deviceId,
			label: d.label || `Camera ${i + 1}`,
		}));
}

/** Open a camera at 720p, or whatever the device settles for. */
export async function openCamera(
	deviceId?: string | null,
): Promise<MediaStream> {
	if (!navigator.mediaDevices?.getUserMedia) {
		throw new Error("This browser can't open a camera.");
	}
	try {
		return await navigator.mediaDevices.getUserMedia({
			audio: false,
			video: {
				...(deviceId ? { deviceId: { exact: deviceId } } : {}),
				width: { ideal: 1280 },
				height: { ideal: 720 },
				frameRate: { ideal: 30 },
			},
		});
	} catch (e) {
		throw new Error(cameraErrorMessage(e));
	}
}

export function stopStream(stream: MediaStream | null | undefined) {
	stream?.getTracks().forEach((t) => t.stop());
}

function cameraErrorMessage(e: unknown): string {
	const name = e instanceof DOMException ? e.name : "";
	switch (name) {
		case "NotAllowedError":
		case "SecurityError":
			return "Camera access was blocked. Allow it in the browser and try again.";
		case "NotFoundError":
		case "OverconstrainedError":
			return "No camera found.";
		case "NotReadableError":
		case "AbortError":
			return "The camera is busy in another app.";
		default:
			return e instanceof Error && e.message
				? e.message
				: "Couldn't open the camera.";
	}
}

/** Single mode's live source, wearing a File: an empty file with a type nothing else
 * claims, and the stream looked up beside it. */
export const LIVE_FILE_TYPE = "application/x-openmosh-live";

interface LiveEntry {
	stream: MediaStream;
	deviceId: string | null;
}

const liveEntries = new WeakMap<File, LiveEntry>();

export function createLiveFile(
	stream: MediaStream,
	deviceId: string | null,
): File {
	const file = new File([], "Webcam", { type: LIVE_FILE_TYPE });
	liveEntries.set(file, { stream, deviceId });
	return file;
}

export function isLiveFile(file: File | null | undefined): boolean {
	return !!file && file.type === LIVE_FILE_TYPE;
}

/** The camera behind a live file, re-opened if it was stopped meanwhile. */
export async function liveStreamOf(file: File): Promise<MediaStream | null> {
	const entry = liveEntries.get(file);
	if (!entry) return null;
	if (entry.stream.active) return entry.stream;
	entry.stream = await openCamera(entry.deviceId);
	return entry.stream;
}

/** Release the camera behind a live file. The file can still re-open it. */
export function stopLiveFile(file: File) {
	const entry = liveEntries.get(file);
	if (entry) stopStream(entry.stream);
}
