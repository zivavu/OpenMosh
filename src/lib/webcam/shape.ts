import {
	clampCrop,
	FULL_CROP,
	isFullCrop,
	type CropRect,
} from "../media/source-edit";
import { readJson, writeJson } from "../storage";

/** How the camera's picture is turned and cut before anything uses it. The crop is
 * taken from the flipped picture, the one the panel shows. */
export interface CameraShape {
	flipX: boolean;
	flipY: boolean;
	crop: CropRect;
}

export const PLAIN_SHAPE: CameraShape = {
	flipX: false,
	flipY: false,
	crop: FULL_CROP,
};

const SHAPE_KEY = "openmosh-webcam-shape";

export function isPlainShape(shape: CameraShape): boolean {
	return !shape.flipX && !shape.flipY && isFullCrop(shape.crop);
}

export function loadShape(): CameraShape {
	const raw = readJson<Partial<CameraShape> | null>(SHAPE_KEY, null);
	if (!raw || typeof raw !== "object") return { ...PLAIN_SHAPE };
	const c = (raw.crop ?? {}) as Partial<CropRect>;
	const num = (v: unknown, d: number) =>
		typeof v === "number" && Number.isFinite(v) ? v : d;
	return {
		flipX: raw.flipX === true,
		flipY: raw.flipY === true,
		crop: clampCrop({
			x: num(c.x, 0),
			y: num(c.y, 0),
			w: num(c.w, 1),
			h: num(c.h, 1),
		}),
	};
}

export function saveShape(shape: CameraShape) {
	writeJson(SHAPE_KEY, shape);
}

/** Even, since video encoders want it. */
function evenPx(v: number): number {
	return Math.max(2, Math.round(v / 2) * 2);
}

/** The output size for a `width`×`height` camera, and the `setTransform` that
 * draws the whole camera frame into it. */
export function shapeLayout(width: number, height: number, shape: CameraShape) {
	const { crop } = shape;
	const outW = evenPx(width * crop.w);
	const outH = evenPx(height * crop.h);
	const kx = outW / (width * crop.w);
	const ky = outH / (height * crop.h);
	return {
		width: outW,
		height: outH,
		a: shape.flipX ? -kx : kx,
		d: shape.flipY ? -ky : ky,
		e: kx * ((shape.flipX ? width : 0) - crop.x * width),
		f: ky * ((shape.flipY ? height : 0) - crop.y * height),
	};
}

/** Draw `video`'s current frame, shaped, sizing the canvas to fit. */
export function drawShaped(
	canvas: HTMLCanvasElement,
	ctx: CanvasRenderingContext2D,
	video: HTMLVideoElement,
	shape: CameraShape,
): boolean {
	const w = video.videoWidth;
	const h = video.videoHeight;
	if (!w || !h) return false;
	const l = shapeLayout(w, h, shape);
	if (canvas.width !== l.width) canvas.width = l.width;
	if (canvas.height !== l.height) canvas.height = l.height;
	ctx.setTransform(l.a, 0, 0, l.d, l.e, l.f);
	ctx.drawImage(video, 0, 0, w, h);
	ctx.setTransform(1, 0, 0, 1, 0, 0);
	return true;
}

/** A camera stream redrawn through a canvas with its shape applied. */
export interface ShapedStream {
	stream: MediaStream;
	/** Stop redrawing. The camera itself keeps running. */
	release(): void;
}

/** `raw` itself when the shape changes nothing; resolves once the first frame is in,
 * so the stream's size is right from the start. */
export async function shapeStream(
	raw: MediaStream,
	shape: CameraShape,
): Promise<ShapedStream> {
	if (isPlainShape(shape)) return { stream: raw, release: () => {} };
	const video = document.createElement("video");
	video.muted = true;
	video.playsInline = true;
	video.srcObject = raw;
	await video.play();
	const canvas = document.createElement("canvas");
	const ctx = canvas.getContext("2d")!;
	drawShaped(canvas, ctx, video, shape);
	const fps = raw.getVideoTracks()[0]?.getSettings().frameRate ?? 30;
	const stream = canvas.captureStream(fps);
	let rafId = 0;
	const tick = () => {
		drawShaped(canvas, ctx, video, shape);
		rafId = requestAnimationFrame(tick);
	};
	rafId = requestAnimationFrame(tick);
	let released = false;
	const release = () => {
		if (released) return;
		released = true;
		cancelAnimationFrame(rafId);
		stream.getTracks().forEach((t) => t.stop());
		video.srcObject = null;
	};
	// An unplugged camera ends the shaped stream too, so it reads as gone.
	raw.getVideoTracks()[0]?.addEventListener("ended", release);
	return { stream, release };
}
