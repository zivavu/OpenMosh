import type { EffectInstance } from "../effects";
import { ensureFontLoaded, fontsVersion } from "../text-overlay";
import {
	drawTextToCanvas,
	textSignature,
	type ResolvedTextLayer,
} from "../text";
import {
	MASK_SDF_RANGE,
	MASK_SDF_SOFT,
	type MaskCentre,
	type MaskField,
	maskShift,
	maskToSdf,
} from "../media/mask-sdf";
import { sampleSourceEdit, wrapSourceTime } from "../media";
import type { MediaStyle, ResolvedMediaLayer, SourceEdit } from "../media";
import {
	CAPTION_EFFECT_ID,
	captionSignature,
	drawCaptionToCanvas,
	readCaptionParams,
} from "../caption";
import { DEFAULT_AUDIO_RESPONSE } from "../audio/auto-range";
import {
	dropSpectrumFollower,
	normalizeSpectrum,
	smoothSpectrum,
} from "../audio/spectrum-range";
import { createProgram, getUniformLocations } from "./utils";
import {
	VERTEX_SHADER,
	PASSTHROUGH_FRAG,
	TEXT_BLEND_FRAG,
	LAYER_TRANSFORM_FRAG,
	EFFECT_SHADERS,
	type EffectShaderDef,
} from "./effect-shaders";
import { TRANSITION_SHADERS } from "./transition-shaders";
import type { TextOverlayBlendMode } from "../text-overlay";
import {
	TRACKING_EFFECT_ID,
	computeSaliency,
	lumFromRGBA,
	readTrackingParams,
	syncBoxes,
	resolveFrame,
	trackBoxes,
	drawTrackingToCanvas,
	trackingFrameSignature,
	type TrackingParams,
	type TrackingState,
} from "../tracking";

/** Cached 2D-drawn overlay texture; `sig` covers everything the draw depends on. */
interface OverlayTexture {
	tex: WebGLTexture;
	w: number;
	h: number;
	sig: string;
}

/** Framebuffer statuses already reported, so a broken target logs once. */
const reportedFBOStatuses = new Set<number>();

/** Effect ids already warned about, so a stale preset logs once, not per frame. */
const reportedUnknownEffects = new Set<string>();

interface CompiledProgram {
	program: WebGLProgram;
	uniforms: Record<string, WebGLUniformLocation>;
}

/** How a source whose aspect differs from the output is fitted (mixed media pool only). */
export type SourceFit = "stretch" | "contain" | "cover";

/** A still source the renderer can upload. ImageBitmap is the cheap form (already decoded). */
export type SourceImage = HTMLImageElement | ImageBitmap;

function imageWidth(image: SourceImage): number {
	return image instanceof HTMLImageElement ? image.naturalWidth : image.width;
}

function imageHeight(image: SourceImage): number {
	return image instanceof HTMLImageElement ? image.naturalHeight : image.height;
}

/** A layer with its chain already rendered, ready to composite. */
interface PreparedLayer {
	tex: WebGLTexture;
	/** True = composite before the first effect, so the chain distorts it. */
	underEffects: boolean;
	/** Order among all layers. Prepared layers arrive already sorted by it. */
	z: number;
	opacity: number;
	blendMode: TextOverlayBlendMode;
}

/** Where a media layer's frame sits, in output pixels. The placement pass's
 * alpha is the only coverage downstream reads. */
interface LayerBox {
	drawW: number;
	drawH: number;
	/** Centre, in frame uv. */
	cx: number;
	cy: number;
	/** Radians, clockwise. */
	rot: number;
}

type ChainOp =
	| { kind: "effect"; eff: EffectInstance }
	| { kind: "layer"; layer: PreparedLayer };

/** Slot the layers into the effect chain: `underEffects` layers go ahead of the
 * first effect, the rest over the finished frame. Callers pass a list sorted by z. */
function buildChainOps(
	effects: EffectInstance[],
	layers: PreparedLayer[],
): ChainOp[] {
	const ops: ChainOp[] = [];
	for (const layer of layers) {
		if (layer.underEffects) ops.push({ kind: "layer", layer });
	}
	for (const eff of effects) {
		if (eff.enabled) ops.push({ kind: "effect", eff });
	}
	for (const layer of layers) {
		if (!layer.underEffects) ops.push({ kind: "layer", layer });
	}
	return ops;
}

/** One stacked fx lane's contribution for a frame. A weight below 1 mixes the
 * lane's output back over its input, fading its clip in and out. */
export interface PostChainLayer {
	effects: EffectInstance[];
	/** 0 = lane absent, 1 = fully applied. */
	weight: number;
	/** Place in the stack shared with the layers; higher runs later. */
	z: number;
}

/** One rung of the stack over the root chain: a layer, or an fx lane's chain
 * applied to everything beneath it. Sorted by z, bottom first. */
type StackStep =
	| { kind: "layer"; layer: PreparedLayer }
	| { kind: "fx"; lane: PostChainLayer };

function buildStack(
	layers: PreparedLayer[],
	post: PostChainLayer[],
): StackStep[] {
	const steps: StackStep[] = [
		...layers.map((layer) => ({ kind: "layer" as const, layer })),
		...post.map((lane) => ({ kind: "fx" as const, lane })),
	];
	return steps.sort((a, b) => stepZ(a) - stepZ(b));
}

function stepZ(step: StackStep): number {
	return step.kind === "layer" ? step.layer.z : step.lane.z;
}

/** Lanes that actually change the frame, in stack order. Sorted here because the
 * flattened fast path concatenates them into one chain. */
function livePostLayers(layers: PostChainLayer[]): PostChainLayer[] {
	return layers
		.filter((l) => l.weight > 0 && l.effects.some((e) => e.enabled))
		.sort((a, b) => a.z - b.z);
}

/** True when every live lane applies at full strength, so they run as one concatenated chain. */
function allFullWeight(layers: PostChainLayer[]): boolean {
	return layers.every((l) => l.weight >= 1);
}

/** Collect instance ids into `live`, so feedback buffers survive the GC. */
function addInstanceIds(live: Set<string>, effects: EffectInstance[]): void {
	for (const e of effects) live.add(e.instanceId);
}

function addLayerInstanceIds(
	live: Set<string>,
	layers: ResolvedTextLayer[],
): void {
	for (const layer of layers) addInstanceIds(live, layer.effects);
}

function addMediaInstanceIds(
	live: Set<string>,
	layers: ResolvedMediaLayer[],
): void {
	for (const layer of layers) addInstanceIds(live, layer.effects);
}

function addPostInstanceIds(live: Set<string>, post: PostChainLayer[]): void {
	for (const l of post) addInstanceIds(live, l.effects);
}

/** One clear texel; see GlRenderer.clearSource. */
const CLEAR_PIXEL = new Uint8Array([0, 0, 0, 0]);

export class GlRenderer {
	private gl: WebGL2RenderingContext;
	private quadVAO: WebGLVertexArrayObject;
	private sourceTexture: WebGLTexture | null = null;
	private sourceFit: SourceFit = "contain";
	/** Second source texture, holding the outgoing media while a transition runs.
	 * Only allocated once a transition crosses two different sources. */
	private altSourceTexture: WebGLTexture | null = null;
	private altTexW = 0;
	private altTexH = 0;
	private altStageTexture: WebGLTexture | null = null;
	private altStageFBO: WebGLFramebuffer | null = null;
	/** Output-sized copy of the source, letterboxed or cropped. Only allocated when
	 * a source's aspect differs from the output. */
	private stageTexture: WebGLTexture | null = null;
	private stageFBO: WebGLFramebuffer | null = null;
	/** Allocated dimensions of sourceTexture, so per-frame uploads take the
	 * texSubImage2D fast path when the size is unchanged. */
	private srcTexW = 0;
	private srcTexH = 0;
	private ppTextures: [WebGLTexture, WebGLTexture] | null = null;
	private ppFBOs: [WebGLFramebuffer, WebGLFramebuffer] | null = null;
	/** Final result buffer, needed only when an overlay composites over the chain;
	 * otherwise the last effect draws straight to the canvas. */
	private fbTexture: WebGLTexture | null = null;
	private fbFBO: WebGLFramebuffer | null = null;
	/** Half-float ping-pong for HDR multi-pass effects (bloom/blur), at half the
	 * output resolution: the Gaussian pre-passes are low-frequency, so half-res is fine. */
	private hdrTextures: [WebGLTexture, WebGLTexture] | null = null;
	private hdrFBOs: [WebGLFramebuffer, WebGLFramebuffer] | null = null;
	private hdrW = 0;
	private hdrH = 0;
	/** Per-side outputs for transitions: chain A and chain B render into these. */
	private sceneTextures: [WebGLTexture, WebGLTexture] | null = null;
	private sceneFBOs: [WebGLFramebuffer, WebGLFramebuffer] | null = null;
	/** Holds a finished transition blend while a post chain runs over it. Only
	 * allocated when something stacks on top of a blend. */
	private blendTexture: WebGLTexture | null = null;
	private blendFBO: WebGLFramebuffer | null = null;
	/** Rotation for the stacked fx lanes. Three, not two: fading a lane needs its
	 * input and output readable while a third takes the mix. */
	private stackTextures: WebGLTexture[] | null = null;
	private stackFBOs: WebGLFramebuffer[] | null = null;
	private transitionPrograms = new Map<string, CompiledProgram>();
	/** Private history buffers for feedback-reading effects (u_feedback), keyed by
	 * instanceId: each feeds back its own output, so downstream effects can't loop. */
	private fxFeedback = new Map<
		string,
		{
			textures: [WebGLTexture, WebGLTexture];
			fbos: [WebGLFramebuffer, WebGLFramebuffer];
			idx: number;
		}
	>();
	private passthrough: CompiledProgram;
	private compiled = new Map<
		string,
		{
			program: CompiledProgram;
			def: EffectShaderDef;
			prePasses?: {
				program: CompiledProgram;
				linearFilter?: boolean;
				feedback?: boolean;
			}[];
		}
	>();
	private textBlendProgram: CompiledProgram | null = null;
	private layerTransformProgram: CompiledProgram | null = null;
	/** How many painted shapes stay resident: loose enough not to thrash a hand-keyed
	 * track, tight enough to bound a long session. */
	private static readonly MAX_MASK_TEXTURES = 24;
	/** Reused for turning decoded masks into distance fields. */
	private maskScratch: HTMLCanvasElement | null = null;
	/** One erase mask per source, and the data URL it was decoded from. */
	private maskTextures = new Map<
		string,
		{
			tex: WebGLTexture;
			url: string;
			ready: boolean;
			/** Middle of the erased region, for aligning a morph. See maskShift. */
			centre: MaskCentre;
		}
	>();

	/** Solo: chainSource hands back black rather than the source. Requested for the
	 * next render and cleared by it, so a caller that never asks can't inherit it. */
	private pendingBlank = false;
	private blankSource = false;
	private blankTex: WebGLTexture | null = null;
	private mediaScratch: { tex: WebGLTexture; fbo: WebGLFramebuffer } | null =
		null;
	/** Uploaded (pre-effect) media per media lane, keyed by lane id. */
	private mediaLayerTextures = new Map<string, OverlayTexture>();
	/** Per-source edits, keyed by source id. See setSourceEdits. */
	private sourceEdits = new Map<string, SourceEdit>();
	/** Per-source media length, keyed by source id. See setSourceDurations. */
	private sourceDurations = new Map<string, number>();
	/** Drawn (pre-effect) text per clip, keyed by clip id. */
	private textLayerTextures = new Map<string, OverlayTexture>();
	private textLayerCanvas: HTMLCanvasElement | null = null;
	/** Scratch targets holding each layer's own chain output for this frame. */
	private layerBuffers: { tex: WebGLTexture; fbo: WebGLFramebuffer }[] = [];
	private imgW = 0;
	private imgH = 0;
	private lastTime = -1;
	/** Refilled every frame by beginLiveIds, so the GC pass costs no allocation. */
	private liveIds = new Set<string>();
	/** Reused by getEffectTime; read out before the next call overwrites it. */
	private effectTimeOut = { time: 0, delta: 0 };
	private phaseMap = new Map<string, number>();

	/** Caption overlay textures, keyed by instanceId: one chain can hold any number
	 * of captions. */
	private captionTextures = new Map<string, OverlayTexture>();
	private captionCanvas: HTMLCanvasElement | null = null;

	private trackingStates = new Map<string, TrackingState>();
	private trackingCanvas: HTMLCanvasElement | null = null;
	private trackingTexture: WebGLTexture | null = null;
	private trackingTexW = 0;
	private trackingTexH = 0;
	/** Signature of the HUD currently uploaded in trackingTexture (skip redraws). */
	private lastTrackingSig = "";
	private salFBO: WebGLFramebuffer | null = null;
	private salTexture: WebGLTexture | null = null;
	private salBuf: Uint8Array | null = null;
	private salW = 0;
	private salH = 0;
	/** PBO for non-blocking saliency readback + the in-flight fence, if any. */
	private salPBO: WebGLBuffer | null = null;
	private salFence: WebGLSync | null = null;
	private salPending: {
		state: TrackingState;
		params: TrackingParams;
		time: number;
	} | null = null;

	constructor(private canvas: HTMLCanvasElement) {
		// antialias defaults to true, which multisamples and resolves the default
		// framebuffer every present; every pass here is a full-viewport quad with no edge.
		const gl = canvas.getContext("webgl2", {
			preserveDrawingBuffer: true,
			antialias: false,
			// Straight alpha to the canvas: a blank base and the fit's bars are clear, and a
			// layer's soft edge is its own colour at partial coverage. Premultiplied reads brighter.
			premultipliedAlpha: false,
		});
		if (!gl) throw new Error("WebGL2 not supported");
		this.gl = gl;
		gl.getExtension("EXT_color_buffer_float");
		this.quadVAO = this.createQuad();
		this.passthrough = this.compile(PASSTHROUGH_FRAG);
		this.textBlendProgram = this.compile(TEXT_BLEND_FRAG);
		this.layerTransformProgram = this.compile(LAYER_TRANSFORM_FRAG);
		// Effect and transition programs compile on first use: linking all ~60 costs
		// Firefox nearly two seconds on the main thread, and a constructor can't yield.
	}

	/** How a canvas parked in <body> is styled to hold its GL context without
	 * affecting the page: `position:fixed` with an explicit 1px box, not `absolute`. */
	static readonly PARKED_CANVAS_STYLE =
		"position:fixed;top:0;left:0;width:1px;height:1px;visibility:hidden;pointer-events:none";

	/** Pre-compile all shaders on a hidden 1x1 canvas so the first real render
	 * doesn't pay for it. */
	static warmup(): { canvas: HTMLCanvasElement; renderer: GlRenderer } {
		// Sweep any warm canvas parked from a previous cycle. Only direct children of
		// <body>: one adopted into an editor is still in use.
		for (const stale of document.body.querySelectorAll(
			":scope > canvas[data-openmosh-warm]",
		)) {
			stale.remove();
		}
		const canvas = document.createElement("canvas");
		canvas.width = 1;
		canvas.height = 1;
		canvas.dataset.openmoshWarm = "1";
		canvas.style.cssText = GlRenderer.PARKED_CANVAS_STYLE;
		document.body.appendChild(canvas);
		const renderer = new GlRenderer(canvas);
		return { canvas, renderer };
	}

	/** Point at the canvas element after it has moved in the DOM. The GL context
	 * stays intact. */
	adoptCanvas(canvas: HTMLCanvasElement) {
		this.canvas = canvas;
	}

	loadImage(image: SourceImage) {
		if (!this.resetSource(imageWidth(image), imageHeight(image))) return;
		const gl = this.gl;
		gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, image);
	}

	loadVideo(video: HTMLVideoElement) {
		if (!this.resetSource(video.videoWidth, video.videoHeight)) return;
		const gl = this.gl;
		gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, video);
	}

	/** Allocate the source texture and FBOs for externally-decoded VideoFrames
	 * (WebCodecs preview). */
	initVideoSource(w: number, h: number) {
		this.resetSource(w, h);
	}

	/** Size the frame with nothing on the source texture: the sequence editor's
	 * base, black under the layers. */
	initBlankSource(w: number, h: number) {
		if (!this.resetSource(w, h)) return;
		this.clearSource();
	}

	/** Put one clear pixel on the source texture, stretched over the frame by the
	 * fit: cheaper than clearing a full-size texture. */
	clearSource() {
		if (!this.sourceTexture) return;
		const gl = this.gl;
		gl.bindTexture(gl.TEXTURE_2D, this.sourceTexture);
		gl.texImage2D(
			gl.TEXTURE_2D,
			0,
			gl.RGBA,
			1,
			1,
			0,
			gl.RGBA,
			gl.UNSIGNED_BYTE,
			CLEAR_PIXEL,
		);
		this.srcTexW = 1;
		this.srcTexH = 1;
	}

	/** Size the output to `w`x`h` and hand back a freshly bound source texture.
	 * False when the dimensions aren't usable: a 0x0 source texture breaks every later draw. */
	private resetSource(w: number, h: number): boolean {
		if (w === 0 || h === 0) return false;
		const gl = this.gl;
		this.imgW = w;
		this.imgH = h;
		if (this.canvas.width !== w) this.canvas.width = w;
		if (this.canvas.height !== h) this.canvas.height = h;

		if (this.sourceTexture) gl.deleteTexture(this.sourceTexture);
		this.sourceTexture = this.createTexture(w, h);
		this.srcTexW = w;
		this.srcTexH = h;

		this.setupPingPong();
		// setupPingPong binds its own textures last, so rebind before returning:
		// callers upload straight into TEXTURE_2D.
		gl.bindTexture(gl.TEXTURE_2D, this.sourceTexture);
		return true;
	}

	/** Wall-clock ms spent uploading frames since the reader last zeroed it, and the
	 * switch that collects it. Off by default: a stat nobody shows costs no clock read. */
	measureUploads = false;
	uploadMs = 0;

	/** What the chain actually runs at, and what the source texture holds: a preview
	 * drawing far more pixels than it shows is invisible from the outside without them. */
	get sizes() {
		return {
			w: this.imgW,
			h: this.imgH,
			srcW: this.srcTexW,
			srcH: this.srcTexH,
		};
	}

	#timeUpload(upload: () => void) {
		if (!this.measureUploads) return upload();
		const started = performance.now();
		upload();
		this.uploadMs += performance.now() - started;
	}

	updateSourceFrame(source: HTMLVideoElement | VideoFrame) {
		if (!this.sourceTexture) return;
		// Skip uploads while the element has no decoded frame (seeking or stalled):
		// Firefox uploads zeros, flashing black instead of holding the frame
		if (
			source instanceof HTMLVideoElement &&
			(source.readyState < 2 || source.videoWidth === 0)
		) {
			return;
		}
		const w =
			source instanceof HTMLVideoElement
				? source.videoWidth
				: source.displayWidth;
		const h =
			source instanceof HTMLVideoElement
				? source.videoHeight
				: source.displayHeight;
		const gl = this.gl;
		gl.bindTexture(gl.TEXTURE_2D, this.sourceTexture);
		// Fast path: texSubImage2D writes into the existing allocation, where
		// texImage2D would reallocate and revalidate storage every frame.
		this.#timeUpload(() => {
			if (w === this.srcTexW && h === this.srcTexH) {
				gl.texSubImage2D(
					gl.TEXTURE_2D,
					0,
					0,
					0,
					gl.RGBA,
					gl.UNSIGNED_BYTE,
					source,
				);
			} else {
				gl.texImage2D(
					gl.TEXTURE_2D,
					0,
					gl.RGBA,
					gl.RGBA,
					gl.UNSIGNED_BYTE,
					source,
				);
				this.srcTexW = w;
				this.srcTexH = h;
			}
		});
	}

	updateSourceImage(image: SourceImage) {
		if (!this.sourceTexture) return;
		const gl = this.gl;
		const w = imageWidth(image);
		const h = imageHeight(image);
		gl.bindTexture(gl.TEXTURE_2D, this.sourceTexture);
		// Same fast path as updateSourceFrame: a slideshow cutting between same-sized
		// images reuses the allocation.
		if (w === this.srcTexW && h === this.srcTexH) {
			gl.texSubImage2D(
				gl.TEXTURE_2D,
				0,
				0,
				0,
				gl.RGBA,
				gl.UNSIGNED_BYTE,
				image,
			);
			return;
		}
		gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, image);
		this.srcTexW = w;
		this.srcTexH = h;
	}

	// A layer's frame is uploaded by the caller, keyed by lane: a lane shows one
	// clip at a time, so one texture per lane is all it needs.

	/** Per-source edits, pushed in when they change rather than carried on each
	 * frame's resolved layers: the edit belongs to the media, so every lane sees the same. */
	setSourceEdits(edits: Map<string, SourceEdit>) {
		this.sourceEdits = edits;
	}

	/** How long each source's media runs, so a keyed edit can be sampled where the
	 * frame sampler wrapped to. A source missing from the map is an image. */
	setSourceDurations(durations: Map<string, number>) {
		this.sourceDurations = durations;
	}

	/** Seconds into a source's own media, wrapped as the frame sampler wraps it. */
	private editTime(sourceId: string | null, time: number): number {
		return wrapSourceTime(time, this.sourceDurations.get(sourceId ?? "") ?? 0);
	}

	/** Start the next render's chain from black instead of the source; the solo
	 * button uses it. One-shot: the preview re-asks every frame. */
	setBlankSource(on: boolean) {
		this.pendingBlank = on;
	}

	private takeBlankSource() {
		this.blankSource = this.pendingBlank;
		this.pendingBlank = false;
	}

	/** 1x1 opaque black, stretched over the frame by the sampler. */
	private blankTexture(): WebGLTexture {
		if (this.blankTex) return this.blankTex;
		const gl = this.gl;
		const tex = gl.createTexture()!;
		gl.bindTexture(gl.TEXTURE_2D, tex);
		gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
		gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
		gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
		gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
		gl.texImage2D(
			gl.TEXTURE_2D,
			0,
			gl.RGBA,
			1,
			1,
			0,
			gl.RGBA,
			gl.UNSIGNED_BYTE,
			new Uint8Array([0, 0, 0, 255]),
		);
		this.blankTex = tex;
		return tex;
	}

	/** The erase mask for a source, decoding it on first use. Returns null until the
	 * image lands, so a frame drawn meanwhile shows the media whole. Keyed by the mask. */
	private maskTexture(url: string): WebGLTexture | null {
		const held = this.maskTextures.get(url);
		if (held) return held.ready ? held.tex : null;
		// A track has as many shapes as it has keys, so keeping every one would leak.
		// Oldest out first; Map keeps insertion order.
		while (this.maskTextures.size >= GlRenderer.MAX_MASK_TEXTURES) {
			const oldest = this.maskTextures.keys().next();
			if (oldest.done) break;
			const drop = this.maskTextures.get(oldest.value);
			if (drop) this.gl.deleteTexture(drop.tex);
			this.maskTextures.delete(oldest.value);
		}
		const gl = this.gl;
		const tex = gl.createTexture()!;
		gl.bindTexture(gl.TEXTURE_2D, tex);
		gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
		gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
		gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
		gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
		const entry = { tex, url, ready: false, centre: null as MaskCentre };
		this.maskTextures.set(url, entry);
		const img = new Image();
		img.onload = () => {
			// The edit may have moved on, or the context been rebuilt, while this
			// decoded; only fill the texture this load was started for.
			if (this.maskTextures.get(url) !== entry) return;
			gl.bindTexture(gl.TEXTURE_2D, tex);
			// Stored as a distance field rather than coverage, so two keys interpolate at
			// their boundary. Built once per painted shape, where the decode already costs a frame.
			const sdf = this.sdfPixels(img);
			if (sdf) {
				entry.centre = sdf.field.centre;
				gl.texImage2D(
					gl.TEXTURE_2D,
					0,
					gl.RGBA,
					sdf.width,
					sdf.height,
					0,
					gl.RGBA,
					gl.UNSIGNED_BYTE,
					sdf.field.data,
				);
			} else {
				gl.texImage2D(
					gl.TEXTURE_2D,
					0,
					gl.RGBA,
					gl.RGBA,
					gl.UNSIGNED_BYTE,
					img,
				);
			}
			entry.ready = true;
			this.onMaskReady?.();
		};
		img.src = url;
		return null;
	}

	/** The decoded mask as a distance field, or null if 2D canvas is unavailable. */
	private sdfPixels(
		img: HTMLImageElement,
	): { field: MaskField; width: number; height: number } | null {
		const w = img.naturalWidth;
		const h = img.naturalHeight;
		if (w <= 0 || h <= 0) return null;
		const canvas = (this.maskScratch ??= document.createElement("canvas"));
		canvas.width = w;
		canvas.height = h;
		const ctx = canvas.getContext("2d", { willReadFrequently: true });
		if (!ctx) return null;
		ctx.clearRect(0, 0, w, h);
		ctx.drawImage(img, 0, 0);
		const px = ctx.getImageData(0, 0, w, h);
		return { field: maskToSdf(px.data, w, h), width: w, height: h };
	}

	/** Called when a mask finishes decoding, so a paused preview redraws. */
	onMaskReady: (() => void) | null = null;

	hasLayerTexture(key: string): boolean {
		return this.mediaLayerTextures.has(key);
	}

	/** Where this lane's media lands in the output, for the preview's selection
	 * outline. Reads the same `layerBox` the placement pass draws with, so it can't drift. */
	mediaLayerRect(
		key: string,
		style: MediaStyle,
	): { x: number; y: number; w: number; h: number; rot: number } | null {
		const entry = this.mediaLayerTextures.get(key);
		if (!entry || entry.w <= 0 || this.imgW <= 0) return null;
		const box = this.layerBox(style, entry.w, entry.h);
		return {
			x: box.cx * this.imgW - box.drawW / 2,
			y: box.cy * this.imgH - box.drawH / 2,
			w: box.drawW,
			h: box.drawH,
			rot: box.rot,
		};
	}

	updateLayerImage(key: string, image: SourceImage) {
		this.uploadLayerTexture(key, image, imageWidth(image), imageHeight(image));
	}

	updateLayerFrame(key: string, frame: VideoFrame) {
		this.uploadLayerTexture(
			key,
			frame,
			frame.displayWidth,
			frame.displayHeight,
		);
	}

	/** Release a lane's frame: its source was cleared, or the lane is gone. */
	dropLayerTexture(key: string) {
		const entry = this.mediaLayerTextures.get(key);
		if (!entry) return;
		this.gl.deleteTexture(entry.tex);
		this.mediaLayerTextures.delete(key);
	}

	private uploadLayerTexture(
		key: string,
		source: TexImageSource,
		w: number,
		h: number,
	) {
		if (w <= 0 || h <= 0) return;
		const gl = this.gl;
		let entry = this.mediaLayerTextures.get(key);
		if (!entry) {
			const tex = gl.createTexture()!;
			gl.bindTexture(gl.TEXTURE_2D, tex);
			// LINEAR and clamped, unlike the chain's buffers: the placement pass samples
			// this at an arbitrary scale, where NEAREST would alias a shrunk photo.
			gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
			gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
			gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
			gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
			entry = { tex, w: 0, h: 0, sig: "" };
			this.mediaLayerTextures.set(key, entry);
		} else {
			gl.bindTexture(gl.TEXTURE_2D, entry.tex);
		}
		// Same fast path as the source uploads: a playing video lane keeps its
		// allocation instead of revalidating storage every frame.
		const held = entry;
		this.#timeUpload(() => {
			if (held.w === w && held.h === h) {
				gl.texSubImage2D(
					gl.TEXTURE_2D,
					0,
					0,
					0,
					gl.RGBA,
					gl.UNSIGNED_BYTE,
					source,
				);
			} else {
				gl.texImage2D(
					gl.TEXTURE_2D,
					0,
					gl.RGBA,
					gl.RGBA,
					gl.UNSIGNED_BYTE,
					source,
				);
				held.w = w;
				held.h = h;
			}
		});
	}

	get hasAltSource(): boolean {
		return !!this.altSourceTexture;
	}

	updateAltSourceImage(image: SourceImage) {
		this.uploadAlt(image, imageWidth(image), imageHeight(image));
	}

	updateAltSourceFrame(source: HTMLVideoElement | VideoFrame) {
		if (
			source instanceof HTMLVideoElement &&
			(source.readyState < 2 || source.videoWidth === 0)
		) {
			return;
		}
		const w =
			source instanceof HTMLVideoElement
				? source.videoWidth
				: source.displayWidth;
		const h =
			source instanceof HTMLVideoElement
				? source.videoHeight
				: source.displayHeight;
		this.uploadAlt(source, w, h);
	}

	/** Forget the outgoing media so a later transition can't reuse a stale frame. */
	clearAltSource() {
		const gl = this.gl;
		if (this.altSourceTexture) gl.deleteTexture(this.altSourceTexture);
		this.altSourceTexture = null;
		this.altTexW = 0;
		this.altTexH = 0;
		this.deleteAltStageBuffer();
	}

	private uploadAlt(source: TexImageSource, w: number, h: number) {
		if (w <= 0 || h <= 0) return;
		const gl = this.gl;
		if (!this.altSourceTexture) {
			this.altSourceTexture = this.createTexture(w, h);
			this.altTexW = w;
			this.altTexH = h;
		}
		gl.bindTexture(gl.TEXTURE_2D, this.altSourceTexture);
		this.#timeUpload(() => {
			if (w === this.altTexW && h === this.altTexH) {
				gl.texSubImage2D(
					gl.TEXTURE_2D,
					0,
					0,
					0,
					gl.RGBA,
					gl.UNSIGNED_BYTE,
					source,
				);
			} else {
				gl.texImage2D(
					gl.TEXTURE_2D,
					0,
					gl.RGBA,
					gl.RGBA,
					gl.UNSIGNED_BYTE,
					source,
				);
				this.altTexW = w;
				this.altTexH = h;
				this.deleteAltStageBuffer();
			}
		});
	}

	resize(width: number, height: number) {
		if (width <= 0 || height <= 0) return;
		if (width === this.imgW && height === this.imgH) return;
		this.imgW = width;
		this.imgH = height;
		if (this.canvas.width !== width) this.canvas.width = width;
		if (this.canvas.height !== height) this.canvas.height = height;
		this.setupPingPong();
	}

	render(
		effects: EffectInstance[],
		time = 0,
		textLayers: ResolvedTextLayer[] = [],
		/** Stacked fx lanes, run over the finished chain. See PostChainLayer. */
		postLayers: PostChainLayer[] = [],
		/** Media lanes, composited into the chain at each lane's chain index. */
		mediaLayers: ResolvedMediaLayer[] = [],
	) {
		this.takeBlankSource();
		if (!this.sourceTexture || !this.ppTextures || !this.ppFBOs) return;

		const post = livePostLayers(postLayers);
		const live = this.beginLiveIds();
		addInstanceIds(live, effects);
		addPostInstanceIds(live, post);
		addLayerInstanceIds(live, textLayers);
		addMediaInstanceIds(live, mediaLayers);
		this.gcFxFeedback(live);
		this.gcTextLayers(textLayers);
		this.gcMediaLayers(mediaLayers);
		const safeDt = this.frameDelta(time);
		this.ensurePresentBuffer();
		const presentFBO = this.fbFBO;
		const presentTex = this.fbTexture;
		// Narrowed rather than asserted: createRenderTarget can genuinely fail, and
		// there is nothing to draw into if it did.
		if (!presentFBO || !presentTex) return;
		// Layers run their own chains through the shared ping-pong, so they finish
		// before the main chain starts using it.
		const prepared = this.prepareLayers(textLayers, mediaLayers, time, safeDt);

		// Layers over the finished frame composite after the fx lanes when a lane is
		// under them, which the flat chain can't express.
		const over = prepared.filter((l) => !l.underEffects);

		// Nothing stacked, or nothing to interleave and nothing fading: one chain, no
		// intermediate buffers. Every non-sequence render takes this path.
		if (post.length === 0 || (over.length === 0 && allFullWeight(post))) {
			let flat = effects;
			if (post.length > 0) {
				// By hand rather than flatMap, which allocates a second array per frame.
				flat = effects.slice();
				for (const l of post) flat.push(...l.effects);
			}
			const resultTex = this.renderChainTo(
				flat,
				time,
				safeDt,
				presentFBO,
				presentTex,
				true,
				false,
				prepared,
			);
			this.presentFrame(resultTex);
			return;
		}

		// A fading lane mixes against its own input and an interleaved layer composites
		// between two lanes, so the root chain lands in a buffer rather than the canvas.
		this.ensureSceneBuffers();
		const sceneFBOs = this.sceneFBOs;
		const sceneTextures = this.sceneTextures;
		if (!sceneFBOs || !sceneTextures) return;
		const under = prepared.filter((l) => l.underEffects);
		const baseTex = this.renderChainTo(
			effects,
			time,
			safeDt,
			sceneFBOs[0],
			sceneTextures[0],
			false,
			false,
			under,
		)!;
		this.presentFrame(
			this.renderStack(buildStack(over, post), baseTex, time, safeDt),
		);
	}

	/** Blend two effect chains with a transition shader. A and B each render into
	 * their own scene buffer, then the transition pass composites along `progress`. */
	renderTransition(
		effectsA: EffectInstance[],
		effectsB: EffectInstance[],
		type: string,
		progress: number,
		seed: number,
		direction: number,
		density: number,
		time = 0,
		/** Render chain A from the outgoing source texture, set when the two sides draw
		 * from different media so the media cross-fades too. */
		useAltSourceForA = false,
		textLayers: ResolvedTextLayer[] = [],
		/** Stacked fx lanes, run over the finished blend. Deliberately not appended to
		 * both sides, or one instance would have two passes writing one feedback buffer. */
		postLayers: PostChainLayer[] = [],
		/** Media lanes, composited into both sides' chains. */
		mediaLayers: ResolvedMediaLayer[] = [],
	) {
		if (!this.sourceTexture || !this.ppTextures || !this.ppFBOs) return;
		const post = livePostLayers(postLayers);
		const prog = this.transitionProgram(type);
		if (!prog || progress >= 1) {
			this.render(effectsB, time, textLayers, post, mediaLayers);
			return;
		}

		// Every chain stays alive for the whole blend, so collect feedback buffers
		// against the union or rendering A would drop B's history.
		const live = this.beginLiveIds();
		addInstanceIds(live, effectsA);
		addInstanceIds(live, effectsB);
		addPostInstanceIds(live, post);
		addLayerInstanceIds(live, textLayers);
		addMediaInstanceIds(live, mediaLayers);
		this.gcFxFeedback(live);
		this.gcTextLayers(textLayers);
		this.gcMediaLayers(mediaLayers);
		const safeDt = this.frameDelta(time);

		// One preparation feeding both sides, so the layers ride through the blend
		// rather than popping in when B takes over.
		const prepared = this.prepareLayers(textLayers, mediaLayers, time, safeDt);

		this.ensureSceneBuffers();
		const sceneFBOs = this.sceneFBOs;
		const sceneTextures = this.sceneTextures;
		if (!sceneFBOs || !sceneTextures) return;
		const texA = this.renderChainTo(
			effectsA,
			time,
			safeDt,
			sceneFBOs[0],
			sceneTextures[0],
			false,
			useAltSourceForA && !!this.altSourceTexture,
			prepared,
		);
		const texB = this.renderChainTo(
			effectsB,
			time,
			safeDt,
			sceneFBOs[1],
			sceneTextures[1],
			false,
			false,
			prepared,
		);

		this.ensurePresentBuffer();
		const presentFBO = this.fbFBO;
		if (!presentFBO) return;

		// Nothing stacked on top: blend straight into the present buffer.
		if (post.length === 0) {
			this.drawTransitionPass(
				prog,
				presentFBO,
				texA!,
				texB!,
				progress,
				seed,
				direction,
				density,
				time,
			);
			this.presentFrame(this.fbTexture);
			return;
		}

		// A post chain reads the blend, so the blend can't land in the buffer that
		// chain writes to. Park it in its own texture and hand that over as the source.
		this.ensureBlendBuffer();
		const blendFBO = this.blendFBO;
		const blendTexture = this.blendTexture;
		if (!blendFBO || !blendTexture) return;
		this.drawTransitionPass(
			prog,
			blendFBO,
			texA!,
			texB!,
			progress,
			seed,
			direction,
			density,
			time,
		);
		this.presentFrame(
			this.renderStack(
				buildStack(
					prepared.filter((l) => !l.underEffects),
					post,
				),
				blendTexture,
				time,
				safeDt,
			),
		);
	}

	setSourceFit(fit: SourceFit) {
		this.sourceFit = fit;
	}

	private setSourceEditUniforms(
		prog: CompiledProgram,
		edit: SourceEdit | undefined,
	) {
		const gl = this.gl;
		const key = edit?.chromaKey;
		const keyOn = !!key?.enabled;
		if (prog.uniforms["u_keyColor"]) {
			gl.uniform3f(
				prog.uniforms["u_keyColor"],
				key?.color.r ?? 0,
				key?.color.g ?? 0,
				key?.color.b ?? 0,
			);
		}
		if (prog.uniforms["u_keyThreshold"]) {
			gl.uniform1f(
				prog.uniforms["u_keyThreshold"],
				keyOn ? Math.max(key!.threshold, 0.0001) : 0,
			);
		}
		if (prog.uniforms["u_keySmooth"]) {
			gl.uniform1f(prog.uniforms["u_keySmooth"], key?.smoothing ?? 0);
		}
		if (prog.uniforms["u_keyLuma"]) {
			gl.uniform1f(prog.uniforms["u_keyLuma"], key?.lumaRange ?? 1);
		}
		const crop = edit?.crop;
		if (prog.uniforms["u_crop"]) {
			gl.uniform4f(
				prog.uniforms["u_crop"],
				crop?.x ?? 0,
				crop?.y ?? 0,
				crop?.w ?? 1,
				crop?.h ?? 1,
			);
		}
		const mask = edit?.mask ? this.maskTexture(edit.mask) : null;
		// The shape being morphed into; falls back to the one being left while it decodes.
		const nextUrl = edit?.maskNext;
		const next = nextUrl ? this.maskTexture(nextUrl) : null;
		const morphing = !!mask && !!next;
		const shift =
			morphing && edit?.mask && nextUrl
				? maskShift(
						this.maskTextures.get(edit.mask)?.centre ?? null,
						this.maskTextures.get(nextUrl)?.centre ?? null,
					)
				: { x: 0, y: 0 };
		if (prog.uniforms["u_hasMask"]) {
			gl.uniform1f(prog.uniforms["u_hasMask"], mask ? 1 : 0);
		}
		if (prog.uniforms["u_maskSdf"]) {
			// Only mid-morph. On a key, and on any mask that isn't animated, the shader
			// reads the painting itself and the soft brush survives.
			gl.uniform1f(prog.uniforms["u_maskSdf"], morphing ? 1 : 0);
		}
		if (prog.uniforms["u_maskMix"]) {
			gl.uniform1f(
				prog.uniforms["u_maskMix"],
				morphing ? (edit?.maskMix ?? 0) : 0,
			);
		}
		if (prog.uniforms["u_maskShift"]) {
			gl.uniform2f(prog.uniforms["u_maskShift"], shift.x, shift.y);
		}
		if (prog.uniforms["u_maskSdfShape"]) {
			gl.uniform2f(
				prog.uniforms["u_maskSdfShape"],
				MASK_SDF_SOFT,
				MASK_SDF_RANGE,
			);
		}
		const xf = edit?.maskTransform;
		if (prog.uniforms["u_maskXform"]) {
			gl.uniform3f(
				prog.uniforms["u_maskXform"],
				xf?.x ?? 0,
				xf?.y ?? 0,
				xf?.scale ?? 1,
			);
		}
		if (mask && prog.uniforms["u_mask"]) {
			gl.activeTexture(gl.TEXTURE3);
			gl.bindTexture(gl.TEXTURE_2D, mask);
			gl.uniform1i(prog.uniforms["u_mask"], 3);
		}
		if (mask && prog.uniforms["u_maskNext"]) {
			gl.activeTexture(gl.TEXTURE4);
			// Bound to the same field when nothing is morphing: a sampler left pointing
			// at whatever was in the unit last is undefined, and the mix is 0 either way.
			gl.bindTexture(gl.TEXTURE_2D, morphing ? next! : mask);
			gl.uniform1i(prog.uniforms["u_maskNext"], 4);
		}
	}

	/** The texture the effect chain should read. A source that doesn't share the
	 * output's aspect would be stretched by 0..1 sampling, so it is copied to fit. */
	private chainSource(alt = false): WebGLTexture {
		// Solo: the chain starts from black, so the soloed layer is composited onto an
		// empty frame rather than over the picture it is meant to be told apart from.
		if (this.blankSource) return this.blankTexture();
		let src = alt ? this.altSourceTexture : this.sourceTexture;
		if (!src) return this.sourceTexture!;
		const sw = alt ? this.altTexW : this.srcTexW;
		const sh = alt ? this.altTexH : this.srcTexH;

		if (this.sourceFit === "stretch") return src;
		if (sw <= 0 || sh <= 0 || this.imgW <= 0 || this.imgH <= 0) return src;
		// Sub-pixel differences aren't worth a full-screen pass.
		if (Math.abs(sw / sh - this.imgW / this.imgH) < 0.002) return src;

		const gl = this.gl;
		let stageTex = alt ? this.altStageTexture : this.stageTexture;
		let stageFbo = alt ? this.altStageFBO : this.stageFBO;
		if (!stageTex || !stageFbo) {
			stageTex = this.createTexture(this.imgW, this.imgH);
			const fbo = this.createRenderTarget(stageTex);
			if (!fbo) return src;
			stageFbo = fbo;
			if (alt) {
				this.altStageTexture = stageTex;
				this.altStageFBO = fbo;
			} else {
				this.stageTexture = stageTex;
				this.stageFBO = fbo;
			}
		}

		const scale =
			this.sourceFit === "cover"
				? Math.max(this.imgW / sw, this.imgH / sh)
				: Math.min(this.imgW / sw, this.imgH / sh);
		const w = Math.round(sw * scale);
		const h = Math.round(sh * scale);
		const x = Math.round((this.imgW - w) / 2);
		const y = Math.round((this.imgH - h) / 2);

		gl.bindFramebuffer(gl.FRAMEBUFFER, stageFbo);
		// Clear at full size first, then draw into the fitted rect: "contain" leaves
		// the bars transparent, "cover" clips outside the viewport.
		gl.viewport(0, 0, this.imgW, this.imgH);
		gl.clearColor(0, 0, 0, 0);
		gl.clear(gl.COLOR_BUFFER_BIT);
		gl.viewport(x, y, w, h);
		gl.useProgram(this.passthrough.program);
		gl.activeTexture(gl.TEXTURE0);
		gl.bindTexture(gl.TEXTURE_2D, src);
		if (this.passthrough.uniforms["u_texture"]) {
			gl.uniform1i(this.passthrough.uniforms["u_texture"], 0);
		}
		if (this.passthrough.uniforms["u_flipY"]) {
			gl.uniform1f(this.passthrough.uniforms["u_flipY"], 1.0);
		}
		gl.drawArrays(gl.TRIANGLES, 0, 6);

		return stageTex;
	}

	private deleteStageBuffer() {
		const gl = this.gl;
		if (this.stageTexture) gl.deleteTexture(this.stageTexture);
		if (this.stageFBO) gl.deleteFramebuffer(this.stageFBO);
		this.stageTexture = null;
		this.stageFBO = null;
		this.deleteAltStageBuffer();
	}

	private deleteAltStageBuffer() {
		const gl = this.gl;
		if (this.altStageTexture) gl.deleteTexture(this.altStageTexture);
		if (this.altStageFBO) gl.deleteFramebuffer(this.altStageFBO);
		this.altStageTexture = null;
		this.altStageFBO = null;
	}

	/** The shared live-id set, emptied and ready to refill. */
	private beginLiveIds(): Set<string> {
		this.liveIds.clear();
		return this.liveIds;
	}

	private frameDelta(time: number): number {
		const dt = this.lastTime >= 0 ? time - this.lastTime : 0;
		this.lastTime = time;
		// Guard against time discontinuities (e.g. switching between recording and real-time)
		return dt > 0 && dt < 0.5 ? dt : 0;
	}

	/** Drop per-instance state for effects that no longer exist (deleted, or replaced
	 * by undo or a preset): feedback buffers, phase, tracking and caption maps. */
	private gcFxFeedback(live: Set<string>) {
		for (const [id, pair] of this.fxFeedback) {
			// Stateful pre-passes key their history as "<instanceId>:<pass>".
			const owner = id.includes(":") ? id.slice(0, id.indexOf(":")) : id;
			if (!live.has(owner)) {
				this.deleteTexturePair(pair.textures);
				this.deleteFBOPair(pair.fbos);
				this.fxFeedback.delete(id);
			}
		}
		for (const id of this.phaseMap.keys()) {
			if (!live.has(id)) this.phaseMap.delete(id);
		}
		for (const id of this.spectrumSmoothed.keys()) {
			if (!live.has(id)) {
				this.spectrumSmoothed.delete(id);
				dropSpectrumFollower(id);
			}
		}
		for (const id of this.trackingStates.keys()) {
			if (!live.has(id)) this.trackingStates.delete(id);
		}
		for (const [id, entry] of this.captionTextures) {
			if (!live.has(id)) {
				this.gl.deleteTexture(entry.tex);
				this.captionTextures.delete(id);
			}
		}
	}

	private clearCaptionTextures() {
		for (const entry of this.captionTextures.values()) {
			this.gl.deleteTexture(entry.tex);
		}
		this.captionTextures.clear();
	}

	/** Render one effect chain, writing the final pass into `finalFbo` and returning
	 * the result texture (a private feedback buffer if the last effect reads u_feedback). */
	private renderChainTo(
		effects: EffectInstance[],
		time: number,
		safeDt: number,
		finalFbo: WebGLFramebuffer,
		finalTex: WebGLTexture,
		toCanvas: boolean,
		useAltSource = false,
		layers: PreparedLayer[] = [],
		srcOverride?: WebGLTexture,
	): WebGLTexture | null {
		const srcTex = srcOverride ?? this.chainSource(useAltSource);
		const ops = buildChainOps(effects, layers);

		if (ops.length === 0) {
			if (toCanvas) {
				this.drawPass(this.passthrough, null, srcTex, -1.0, time);
				return null;
			}
			this.drawPass(this.passthrough, finalFbo, srcTex, 1.0, time);
			return finalTex;
		}

		let input = srcTex;
		let ppIdx = 0;
		/** Texture holding the final chain output; null when nothing rendered yet or the
		 * last pass drew to the canvas, which `producedOutput` tells apart. */
		let resultTex: WebGLTexture | null = null;
		let producedOutput = false;

		for (let i = 0; i < ops.length; i++) {
			const op = ops[i];
			const isLast = i === ops.length - 1;

			// A text layer composites over whatever the chain holds at its slot, so effects
			// below it distort it too. Always into an FBO; the final blit is left to presentFrame.
			if (op.kind === "layer") {
				const target = isLast ? finalFbo : this.ppFBOs![ppIdx];
				this.compositeOverlayToFBO(
					input,
					op.layer.tex,
					target,
					op.layer.opacity,
					op.layer.blendMode,
				);
				if (isLast) {
					resultTex = finalTex;
					producedOutput = true;
				} else {
					input = this.ppTextures![ppIdx];
					ppIdx = 1 - ppIdx;
				}
				continue;
			}

			const eff = op.eff;

			// Tracking and captions are CPU-built 2D overlays, not shader passes.
			// Composited over the chain input at this slot so later effects distort them.
			if (eff.defId === TRACKING_EFFECT_ID || eff.defId === CAPTION_EFFECT_ID) {
				const target = isLast ? finalFbo : this.ppFBOs![ppIdx];
				if (eff.defId === CAPTION_EFFECT_ID) {
					this.renderCaption(eff, input, target);
				} else {
					this.renderTracking(eff, input, target, time);
				}
				if (isLast) {
					resultTex = finalTex;
					producedOutput = true;
				} else {
					input = this.ppTextures![ppIdx];
					ppIdx = 1 - ppIdx;
				}
				continue;
			}

			const entry = this.effectEntry(eff.defId);
			if (!entry) {
				// A stale preset or a deleted effect. Reporting it once is what makes "my
				// preset does nothing" diagnosable.
				if (!reportedUnknownEffects.has(eff.defId)) {
					reportedUnknownEffects.add(eff.defId);
					console.warn(`No shader for effect "${eff.defId}" — skipping it.`);
				}
				continue;
			}

			if (entry.program.uniforms["u_spectrum"]) this.uploadSpectrumFor(eff);

			const { time: effectTime, delta: effectDelta } = this.getEffectTime(
				eff,
				time,
				safeDt,
			);

			// Multi-pass effects: pre-passes run through the half-res HDR ping-pong, then
			// composite. Blur width comes from u_resolution, so downsampling lowers resolution.
			const originalInput = input;
			if (entry.prePasses) {
				this.ensureHdrBuffers();
				let hdrIdx = 0;
				for (let p = 0; p < entry.prePasses.length; p++) {
					const pp = entry.prePasses[p];
					// A stateful pre-pass keeps its own full-res history (a background
					// estimate, a held keyframe) that the main pass then reads as its input.
					if (pp.feedback) {
						const pair = this.getFxFeedback(
							`${eff.instanceId}:${p}`,
							input,
							time,
						);
						const writeSlot = 1 - pair.idx;
						this.drawPass(
							pp.program,
							pair.fbos[writeSlot],
							input,
							1.0,
							effectTime,
							entry.def,
							eff.values,
							originalInput,
							effectDelta,
							pair.textures[pair.idx],
						);
						pair.idx = writeSlot as 0 | 1;
						input = pair.textures[writeSlot];
						continue;
					}
					if (pp.linearFilter) this.setTextureFilter(input, true);
					this.drawPass(
						pp.program,
						this.hdrFBOs![hdrIdx],
						input,
						1.0,
						effectTime,
						entry.def,
						eff.values,
						originalInput,
						undefined,
						undefined,
						this.hdrW,
						this.hdrH,
					);
					if (pp.linearFilter) this.setTextureFilter(input, false);
					input = this.hdrTextures![hdrIdx];
					hdrIdx = 1 - hdrIdx;
				}
				// The composite reads the final blurred buffer at full res, so keep it LINEAR for
				// a smooth upsample: setTextureFilter may have left the shared source NEAREST above.
				this.setTextureFilter(input, true);
			}

			if (entry.def.linearFilter) this.setTextureFilter(input, true);

			if (entry.program.uniforms["u_feedback"]) {
				// Feedback effect: render into its private history buffer, reading its own
				// previous output, so downstream effects never enter the loop.
				const pair = this.getFxFeedback(
					eff.instanceId,
					input,
					time,
					entry.def.hdrFeedback,
				);
				const writeSlot = 1 - pair.idx;
				this.drawPass(
					entry.program,
					pair.fbos[writeSlot],
					input,
					1.0,
					effectTime,
					entry.def,
					eff.values,
					entry.prePasses ? originalInput : undefined,
					effectDelta,
					pair.textures[pair.idx],
				);
				pair.idx = writeSlot as 0 | 1;
				if (entry.def.linearFilter) this.setTextureFilter(input, false);
				input = pair.textures[writeSlot];
				if (isLast) {
					resultTex = input;
					producedOutput = true;
				}
				continue;
			}

			if (isLast) {
				if (toCanvas) {
					this.drawPass(
						entry.program,
						null,
						input,
						-1.0,
						effectTime,
						entry.def,
						eff.values,
						entry.prePasses ? originalInput : undefined,
						effectDelta,
					);
				} else {
					this.drawPass(
						entry.program,
						finalFbo,
						input,
						1.0,
						effectTime,
						entry.def,
						eff.values,
						entry.prePasses ? originalInput : undefined,
						effectDelta,
					);
				}
				if (entry.def.linearFilter) this.setTextureFilter(input, false);
				resultTex = toCanvas ? null : finalTex;
				producedOutput = true;
			} else {
				this.drawPass(
					entry.program,
					this.ppFBOs![ppIdx],
					input,
					1.0,
					effectTime,
					entry.def,
					eff.values,
					entry.prePasses ? originalInput : undefined,
					effectDelta,
				);
				if (entry.def.linearFilter) this.setTextureFilter(input, false);
				input = this.ppTextures![ppIdx];
				ppIdx = 1 - ppIdx;
			}
		}

		// Every enabled effect was skipped (unknown ids): fall back to source
		if (!producedOutput) {
			if (toCanvas) {
				this.drawPass(this.passthrough, null, srcTex, -1.0, time);
			} else {
				this.drawPass(this.passthrough, finalFbo, srcTex, 1.0, time);
			}
			resultTex = toCanvas ? null : finalTex;
		}

		return resultTex;
	}

	private drawTransitionPass(
		prog: CompiledProgram,
		targetFBO: WebGLFramebuffer,
		texA: WebGLTexture,
		texB: WebGLTexture,
		progress: number,
		seed: number,
		direction: number,
		density: number,
		time: number,
	) {
		const gl = this.gl;
		gl.bindFramebuffer(gl.FRAMEBUFFER, targetFBO);
		gl.viewport(0, 0, this.imgW, this.imgH);
		gl.useProgram(prog.program);
		if (prog.uniforms["u_flipY"]) gl.uniform1f(prog.uniforms["u_flipY"], 1.0);
		if (prog.uniforms["u_progress"])
			gl.uniform1f(prog.uniforms["u_progress"], progress);
		if (prog.uniforms["u_seed"]) gl.uniform1f(prog.uniforms["u_seed"], seed);
		if (prog.uniforms["u_direction"])
			gl.uniform1i(prog.uniforms["u_direction"], direction);
		if (prog.uniforms["u_density"])
			gl.uniform1i(prog.uniforms["u_density"], density);
		if (prog.uniforms["u_resolution"])
			gl.uniform2f(prog.uniforms["u_resolution"], this.imgW, this.imgH);
		if (prog.uniforms["u_time"]) gl.uniform1f(prog.uniforms["u_time"], time);
		gl.activeTexture(gl.TEXTURE0);
		gl.bindTexture(gl.TEXTURE_2D, texA);
		if (prog.uniforms["u_texture"]) gl.uniform1i(prog.uniforms["u_texture"], 0);
		gl.activeTexture(gl.TEXTURE2);
		gl.bindTexture(gl.TEXTURE_2D, texB);
		if (prog.uniforms["u_texture2"])
			gl.uniform1i(prog.uniforms["u_texture2"], 2);
		gl.drawArrays(gl.TRIANGLES, 0, 6);
		gl.activeTexture(gl.TEXTURE0);
	}

	/** Blit the finished frame to the canvas, when the chain didn't already. */
	private presentFrame(mainResult: WebGLTexture | null) {
		// A feedback effect at the end of the chain writes to its own history buffer,
		// so it needs this blit; otherwise the last pass already drew to the canvas.
		if (mainResult) this.drawPass(this.passthrough, null, mainResult, -1.0, 0);
	}

	/** Get or lazily create the private history buffer for a feedback effect. New
	 * buffers are seeded with the current chain input, so it starts from valid history. */
	private getFxFeedback(
		instanceId: string,
		seedTex: WebGLTexture,
		time: number,
		hdr = false,
	) {
		let pair = this.fxFeedback.get(instanceId);
		if (!pair) {
			const make = () =>
				hdr
					? this.createHdrTexture(this.imgW, this.imgH, false)
					: this.createTexture(this.imgW, this.imgH);
			const textures: [WebGLTexture, WebGLTexture] = [make(), make()];
			const fbos = this.createFBOPair(textures);
			pair = { textures, fbos, idx: 0 };
			this.fxFeedback.set(instanceId, pair);
			this.drawPass(this.passthrough, fbos[0], seedTex, 1.0, time);
			this.drawPass(this.passthrough, fbos[1], seedTex, 1.0, time);
		}
		return pair;
	}

	/** For effects with a speed param, accumulate phase so speed changes don't jump.
	 * Writes into a shared object: this runs per effect per frame. */
	private getEffectTime(
		eff: EffectInstance,
		time: number,
		dt: number,
	): { time: number; delta: number } {
		const out = this.effectTimeOut;
		if (!("speed" in eff.values)) {
			out.time = time;
			out.delta = dt;
			return out;
		}
		// Beat-synced: phase is read off the song's grid rather than accumulated, so
		// flashes land on beats and realign after a seek. No BPM falls back to free-running.
		if (eff.values.sync === "beat" && this.beatPhase !== null) {
			const perBeat = Number(eff.values.division) || 1;
			out.time = this.beatPhase * perBeat;
			out.delta = dt * perBeat * this.beatsPerSecond;
			return out;
		}
		const speed = eff.values.speed as number;
		const prev = this.phaseMap.get(eff.instanceId) ?? 0;
		const phase = prev + dt * speed;
		this.phaseMap.set(eff.instanceId, phase);
		out.time = phase;
		out.delta = dt * speed;
		return out;
	}

	private getTrackingState(instanceId: string): TrackingState {
		let s = this.trackingStates.get(instanceId);
		if (!s) {
			s = {
				boxes: [],
				salPoints: [],
				lastAnalyze: -1,
				lastTick: -1,
				signature: "",
				prevLum: null,
				gridW: 0,
				gridH: 0,
				disturbance: 0,
				primaryKey: -1,
			};
			this.trackingStates.set(instanceId, s);
		}
		return s;
	}

	private ensureSalResources() {
		const gl = this.gl;
		const targetW = 96;
		const targetH = Math.max(
			24,
			Math.min(160, Math.round((targetW * this.imgH) / Math.max(1, this.imgW))),
		);
		if (
			this.salFBO &&
			this.salPBO &&
			this.salW === targetW &&
			this.salH === targetH
		) {
			return;
		}
		this.abortPendingSaliency();
		if (this.salTexture) gl.deleteTexture(this.salTexture);
		if (this.salFBO) gl.deleteFramebuffer(this.salFBO);
		if (this.salPBO) gl.deleteBuffer(this.salPBO);
		this.salW = targetW;
		this.salH = targetH;
		this.salTexture = this.createTexture(targetW, targetH);
		this.salFBO = gl.createFramebuffer()!;
		gl.bindFramebuffer(gl.FRAMEBUFFER, this.salFBO);
		gl.framebufferTexture2D(
			gl.FRAMEBUFFER,
			gl.COLOR_ATTACHMENT0,
			gl.TEXTURE_2D,
			this.salTexture,
			0,
		);
		this.salBuf = new Uint8Array(targetW * targetH * 4);
		gl.bindFramebuffer(gl.FRAMEBUFFER, null);
		this.salPBO = gl.createBuffer()!;
	}

	/** Downsample `srcTex` into the small saliency FBO (leaves it bound). */
	private drawSaliencyPass(srcTex: WebGLTexture) {
		const gl = this.gl;
		gl.bindFramebuffer(gl.FRAMEBUFFER, this.salFBO);
		gl.viewport(0, 0, this.salW, this.salH);
		gl.useProgram(this.passthrough.program);
		if (this.passthrough.uniforms["u_flipY"]) {
			gl.uniform1f(this.passthrough.uniforms["u_flipY"], 1.0);
		}
		this.setTextureFilter(srcTex, true);
		gl.activeTexture(gl.TEXTURE0);
		gl.bindTexture(gl.TEXTURE_2D, srcTex);
		if (this.passthrough.uniforms["u_texture"]) {
			gl.uniform1i(this.passthrough.uniforms["u_texture"], 0);
		}
		gl.drawArrays(gl.TRIANGLES, 0, 6);
		this.setTextureFilter(srcTex, false);
	}

	private processSalBuf(
		state: TrackingState,
		params: TrackingParams,
		time: number,
	) {
		if (!this.salBuf) return;
		const lum = lumFromRGBA(this.salBuf, this.salW * this.salH);
		state.salPoints = computeSaliency(lum, this.salW, this.salH, params);
		trackBoxes(state, params, lum, this.salW, this.salH, time);
	}

	/** Blocking analyze: draw, readPixels, score and track. Only for the first
	 * analysis (or a time reset), so a single-frame render gets a populated HUD. */
	private analyzeSaliencySync(
		state: TrackingState,
		params: TrackingParams,
		srcTex: WebGLTexture,
		time: number,
	) {
		const gl = this.gl;
		this.ensureSalResources();
		if (!this.salFBO || !this.salBuf) return;
		this.drawSaliencyPass(srcTex);
		gl.readPixels(
			0,
			0,
			this.salW,
			this.salH,
			gl.RGBA,
			gl.UNSIGNED_BYTE,
			this.salBuf,
		);
		this.processSalBuf(state, params, time);
	}

	/** Kick off a non-blocking readback: readPixels goes into a PBO (no CPU copy, no
	 * pipeline stall) and a fence records when the GPU is done. pollSaliency collects it. */
	private startSaliencyRead(
		state: TrackingState,
		params: TrackingParams,
		srcTex: WebGLTexture,
		time: number,
	) {
		const gl = this.gl;
		this.ensureSalResources();
		if (!this.salFBO || !this.salPBO || !this.salBuf) return;
		this.drawSaliencyPass(srcTex);
		gl.bindBuffer(gl.PIXEL_PACK_BUFFER, this.salPBO);
		// Orphan the store every read. Chromium keeps a readback shadow per READ-usage
		// buffer and only drops it on bufferData or delete, so reuse warns every cycle.
		gl.bufferData(gl.PIXEL_PACK_BUFFER, this.salBuf.byteLength, gl.STREAM_READ);
		gl.readPixels(0, 0, this.salW, this.salH, gl.RGBA, gl.UNSIGNED_BYTE, 0);
		gl.bindBuffer(gl.PIXEL_PACK_BUFFER, null);
		this.salFence = gl.fenceSync(gl.SYNC_GPU_COMMANDS_COMPLETE, 0);
		this.salPending = { state, params, time };
	}

	/** Collect a finished async readback, if its fence has signaled. Never stalls. */
	private pollSaliency() {
		const gl = this.gl;
		if (!this.salFence || !this.salPending || !this.salPBO || !this.salBuf) {
			return;
		}
		const status = gl.clientWaitSync(this.salFence, 0, 0);
		if (status !== gl.ALREADY_SIGNALED && status !== gl.CONDITION_SATISFIED) {
			return;
		}
		gl.deleteSync(this.salFence);
		this.salFence = null;
		const { state, params, time } = this.salPending;
		this.salPending = null;
		gl.bindBuffer(gl.PIXEL_PACK_BUFFER, this.salPBO);
		gl.getBufferSubData(gl.PIXEL_PACK_BUFFER, 0, this.salBuf);
		gl.bindBuffer(gl.PIXEL_PACK_BUFFER, null);
		this.processSalBuf(state, params, time);
	}

	/** Drop an in-flight readback. With `drain`, the PBO is read (and discarded) so
	 * the driver's pending copy is consumed; skipping it trips Firefox's READ-usage warning. */
	private abortPendingSaliency(drain = false) {
		const gl = this.gl;
		if (this.salFence) {
			if (drain && this.salPBO && this.salBuf) {
				gl.bindBuffer(gl.PIXEL_PACK_BUFFER, this.salPBO);
				gl.getBufferSubData(gl.PIXEL_PACK_BUFFER, 0, this.salBuf);
				gl.bindBuffer(gl.PIXEL_PACK_BUFFER, null);
			}
			gl.deleteSync(this.salFence);
			this.salFence = null;
		}
		this.salPending = null;
	}

	private compositeOverlayToFBO(
		mainTex: WebGLTexture,
		overlayTex: WebGLTexture,
		targetFBO: WebGLFramebuffer,
		opacity: number,
		blendMode: TextOverlayBlendMode = "normal",
	) {
		const gl = this.gl;
		const prog = this.textBlendProgram;
		if (!prog) return;
		gl.bindFramebuffer(gl.FRAMEBUFFER, targetFBO);
		gl.viewport(0, 0, this.imgW, this.imgH);
		gl.useProgram(prog.program);
		if (prog.uniforms["u_flipY"]) gl.uniform1f(prog.uniforms["u_flipY"], 1.0);
		if (prog.uniforms["u_blendMode"])
			gl.uniform1i(
				prog.uniforms["u_blendMode"],
				GlRenderer.BLEND_MODE_VALUES[blendMode],
			);
		if (prog.uniforms["u_invert"]) gl.uniform1f(prog.uniforms["u_invert"], 0);
		if (prog.uniforms["u_opacity"])
			gl.uniform1f(prog.uniforms["u_opacity"], opacity);
		gl.activeTexture(gl.TEXTURE0);
		gl.bindTexture(gl.TEXTURE_2D, mainTex);
		if (prog.uniforms["u_texture"]) gl.uniform1i(prog.uniforms["u_texture"], 0);
		gl.activeTexture(gl.TEXTURE2);
		gl.bindTexture(gl.TEXTURE_2D, overlayTex);
		if (prog.uniforms["u_texture2"])
			gl.uniform1i(prog.uniforms["u_texture2"], 2);
		gl.drawArrays(gl.TRIANGLES, 0, 6);
		gl.activeTexture(gl.TEXTURE0);
	}

	/** Draw each visible text layer and run its own effect chain, so a layer can be
	 * moshed without the image underneath it moving. Returned in the order given. */
	private prepareTextLayers(
		layers: ResolvedTextLayer[],
		time: number,
		safeDt: number,
	): PreparedLayer[] {
		if (layers.length === 0 || this.imgW <= 0 || this.imgH <= 0) return [];
		const prepared: PreparedLayer[] = [];
		for (const layer of layers) {
			const drawn = this.textLayerTexture(layer);
			if (!drawn) continue;
			let tex = drawn;
			if (layer.effects.some((e) => e.enabled)) {
				const buf = this.ensureLayerBuffer(prepared.length);
				if (buf) {
					tex =
						this.renderChainTo(
							layer.effects,
							time,
							safeDt,
							buf.fbo,
							buf.tex,
							false,
							false,
							[],
							drawn,
						) ?? buf.tex;
				}
			}
			prepared.push({
				tex,
				underEffects: layer.underEffects,
				z: layer.z,
				opacity: layer.style.opacity,
				blendMode: layer.style.blendMode,
			});
		}
		return prepared;
	}

	/** Both kinds of layer for this frame, in composite order: one z order spans
	 * text and media alike. */
	private prepareLayers(
		textLayers: ResolvedTextLayer[],
		mediaLayers: ResolvedMediaLayer[],
		time: number,
		safeDt: number,
	): PreparedLayer[] {
		const text = this.prepareTextLayers(textLayers, time, safeDt);
		if (mediaLayers.length === 0) return text;
		const media = this.prepareMediaLayers(
			mediaLayers,
			time,
			safeDt,
			text.length,
		);
		if (media.length === 0) return text;
		// Sorted after preparing, not before: the buffer each layer rendered into is
		// claimed by preparation order, and only the composite cares about z.
		return media.concat(text).sort((a, b) => a.z - b.z);
	}

	/** Place each visible media layer and run its own chain, so a layer can be moshed
	 * without the image underneath it moving. `bufOffset` is where text layers stopped. */
	private prepareMediaLayers(
		layers: ResolvedMediaLayer[],
		time: number,
		safeDt: number,
		bufOffset: number,
	): PreparedLayer[] {
		if (layers.length === 0 || this.imgW <= 0 || this.imgH <= 0) return [];
		const prepared: PreparedLayer[] = [];
		for (const layer of layers) {
			const entry = this.mediaLayerTextures.get(layer.key);
			if (!entry || entry.w <= 0) continue;
			// Sampled per lane, not once for the source: two lanes can hold the same media
			// at different points, each wanting its own instant's crop.
			const stored = this.sourceEdits.get(layer.sourceId);
			const edit = stored
				? sampleSourceEdit(
						stored,
						this.editTime(layer.sourceId, layer.sourceTime),
					)
				: undefined;
			// Fitted against what the crop leaves, not the whole file, so "contain" means the
			// visible rectangle.
			const box = this.layerBox(
				layer.style,
				entry.w * (edit?.crop?.w ?? 1),
				entry.h * (edit?.crop?.h ?? 1),
			);
			const hasChain = layer.effects.some((e) => e.enabled);
			const out = this.ensureLayerBuffer(bufOffset + prepared.length);
			if (!out) continue;

			if (!hasChain) {
				this.drawLayerPlacement(entry.tex, box, out.fbo, edit, 0);
			} else {
				const scratch = this.ensureMediaScratch();
				if (!scratch) continue;
				// Chain first, placement second. The chain runs on the media filling the whole
				// buffer, so an effect's centre or edges are the media's, not the canvas's.
				const grow = this.bleedFactor(layer.style);
				this.drawLayerPlacement(
					entry.tex,
					this.fullFrameBox(1 / grow),
					out.fbo,
					edit,
					0,
				);
				const chained =
					this.renderChainTo(
						layer.effects,
						time,
						safeDt,
						scratch.fbo,
						scratch.tex,
						false,
						false,
						[],
						out.tex,
					) ?? scratch.tex;
				// Safe to write back into `out`: the chain's result lives in the scratch (or a
				// feedback buffer), never in the texture it read. Chain buffers are NEAREST.
				this.setTextureFilter(chained, true);
				this.drawLayerPlacement(
					chained,
					{ ...box, drawW: box.drawW * grow, drawH: box.drawH * grow },
					out.fbo,
					undefined,
					this.edgeFade(layer.style, grow),
				);
				this.setTextureFilter(chained, false);
			}
			prepared.push({
				tex: out.tex,
				underEffects: layer.underEffects,
				z: layer.z,
				// The resolved value, not the lane's: it already carries the clip fade.
				opacity: layer.opacity,
				blendMode: layer.style.blendMode,
			});
		}
		return prepared;
	}

	/** The box a layer's chain runs in: the whole frame, or the middle `fill` of it
	 * when the style asks for bleed. Makes an effect's idea of "the centre" the media's. */
	private fullFrameBox(fill = 1): LayerBox {
		return {
			drawW: this.imgW * fill,
			drawH: this.imgH * fill,
			cx: 0.5,
			cy: 0.5,
			rot: 0,
		};
	}

	/** Grow a placement box by the same factor the fill was shrunk by, so the media
	 * lands where it would have and the margin hangs outside. 1 + 2*bleed: both sides. */
	private bleedFactor(style: MediaStyle): number {
		return 1 + 2 * Math.max(0, style.bleed ?? 0);
	}

	/** The coverage ramp at the grown box's edges, in box uv. Sized from the margin
	 * alone, `(1 - 1/grow) / 2` being how much each side takes, so it dies at the edge. */
	private edgeFade(style: MediaStyle, grow: number): number {
		const fade = Math.max(0, Math.min(1, style.bleedFade ?? 0));
		if (fade <= 0 || grow <= 1) return 0;
		return ((1 - 1 / grow) / 2) * fade;
	}

	private layerBox(style: MediaStyle, texW: number, texH: number): LayerBox {
		const fw = this.imgW;
		const fh = this.imgH;
		let w = fw;
		let h = fh;
		if (style.fit !== "stretch" && texW > 0 && texH > 0) {
			const k =
				style.fit === "cover"
					? Math.max(fw / texW, fh / texH)
					: Math.min(fw / texW, fh / texH);
			w = texW * k;
			h = texH * k;
		}
		const scale = Math.max(style.scale, 0.01);
		return {
			drawW: w * scale * Math.max(style.scaleX ?? 1, 0.01),
			drawH: h * scale * Math.max(style.scaleY ?? 1, 0.01),
			cx: style.x,
			cy: style.y,
			rot: (style.rotation * Math.PI) / 180,
		};
	}

	private setLayerBoxUniforms(prog: CompiledProgram, box: LayerBox) {
		const gl = this.gl;
		if (prog.uniforms["u_frameSize"]) {
			gl.uniform2f(prog.uniforms["u_frameSize"], this.imgW, this.imgH);
		}
		if (prog.uniforms["u_drawSize"]) {
			gl.uniform2f(prog.uniforms["u_drawSize"], box.drawW, box.drawH);
		}
		if (prog.uniforms["u_center"]) {
			gl.uniform2f(prog.uniforms["u_center"], box.cx, box.cy);
		}
		if (prog.uniforms["u_rot"]) gl.uniform1f(prog.uniforms["u_rot"], box.rot);
	}

	/** Draw a layer's media into a full-frame buffer at its placement, keying out
	 * its background colour if the lane asks. */
	private drawLayerPlacement(
		tex: WebGLTexture,
		box: LayerBox,
		targetFBO: WebGLFramebuffer,
		/** The source's own edits: key, crop and erase mask. */
		edit?: SourceEdit,
		/** Coverage ramp at the box's edges, in box uv. 0 = hard edge. */
		edgeFade = 0,
	) {
		const gl = this.gl;
		const prog = this.layerTransformProgram;
		if (!prog) return;
		gl.bindFramebuffer(gl.FRAMEBUFFER, targetFBO);
		gl.viewport(0, 0, this.imgW, this.imgH);
		gl.useProgram(prog.program);
		if (prog.uniforms["u_flipY"]) gl.uniform1f(prog.uniforms["u_flipY"], 1.0);
		if (prog.uniforms["u_edgeFade"]) {
			gl.uniform1f(prog.uniforms["u_edgeFade"], edgeFade);
		}
		this.setSourceEditUniforms(prog, edit);
		this.setLayerBoxUniforms(prog, box);
		gl.activeTexture(gl.TEXTURE0);
		gl.bindTexture(gl.TEXTURE_2D, tex);
		if (prog.uniforms["u_texture"]) gl.uniform1i(prog.uniforms["u_texture"], 0);
		gl.drawArrays(gl.TRIANGLES, 0, 6);
	}

	private ensureMediaScratch(): {
		tex: WebGLTexture;
		fbo: WebGLFramebuffer;
	} | null {
		if (this.mediaScratch) return this.mediaScratch;
		const tex = this.createTexture(this.imgW, this.imgH);
		const fbo = this.createRenderTarget(tex);
		if (!fbo) return null;
		this.mediaScratch = { tex, fbo };
		return this.mediaScratch;
	}

	/** The drawn (pre-effect) text for a clip, redrawn only when it changes. */
	private textLayerTexture(layer: ResolvedTextLayer): WebGLTexture | null {
		// Bundled faces load async: the text draws with a fallback and is redrawn
		// once fontsVersion() moves.
		void ensureFontLoaded(layer.style.fontFamily);

		return this.upsertOverlayTexture(
			this.textLayerTextures,
			layer.key,
			textSignature(
				layer.text,
				layer.style,
				this.imgW,
				this.imgH,
				fontsVersion(),
			),
			(canvas, w, h) => drawTextToCanvas(canvas, w, h, layer.text, layer.style),
			() => (this.textLayerCanvas ??= document.createElement("canvas")),
		);
	}

	/** The cached texture for an overlay, redrawn only when `sig` or the output size
	 * changed. Text layers and captions differ only in what they draw and key by. */
	private upsertOverlayTexture(
		cache: Map<string, OverlayTexture>,
		key: string,
		sig: string,
		draw: (canvas: HTMLCanvasElement, w: number, h: number) => void,
		canvasFor: () => HTMLCanvasElement,
	): WebGLTexture {
		const gl = this.gl;
		const w = this.imgW;
		const h = this.imgH;
		let entry = cache.get(key);
		if (entry && (entry.w !== w || entry.h !== h)) {
			gl.deleteTexture(entry.tex);
			cache.delete(key);
			entry = undefined;
		}
		if (entry && entry.sig === sig) return entry.tex;

		const canvas = canvasFor();
		draw(canvas, w, h);
		if (!entry) {
			const tex = this.createTexture(w, h);
			gl.bindTexture(gl.TEXTURE_2D, tex);
			gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
			gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
			entry = { tex, w, h, sig };
			cache.set(key, entry);
		}
		gl.bindTexture(gl.TEXTURE_2D, entry.tex);
		gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, 0, gl.RGBA, gl.UNSIGNED_BYTE, canvas);
		entry.sig = sig;
		return entry.tex;
	}

	private ensureLayerBuffer(
		index: number,
	): { tex: WebGLTexture; fbo: WebGLFramebuffer } | null {
		const existing = this.layerBuffers[index];
		if (existing) return existing;
		const tex = this.createTexture(this.imgW, this.imgH);
		const fbo = this.createRenderTarget(tex);
		if (!fbo) return null;
		const buf = { tex, fbo };
		this.layerBuffers[index] = buf;
		return buf;
	}

	private gcMediaLayers(layers: ResolvedMediaLayer[]) {
		if (this.mediaLayerTextures.size === 0) return;
		for (const key of this.mediaLayerTextures.keys()) {
			if (!layers.some((l) => l.key === key)) this.dropLayerTexture(key);
		}
	}

	private gcTextLayers(layers: ResolvedTextLayer[]) {
		if (this.textLayerTextures.size === 0) return;
		const live = new Set(layers.map((l) => l.key));
		for (const [key, entry] of this.textLayerTextures) {
			if (!live.has(key)) {
				this.gl.deleteTexture(entry.tex);
				this.textLayerTextures.delete(key);
			}
		}
	}

	private deleteLayerBuffers() {
		const gl = this.gl;
		for (const buf of this.layerBuffers) {
			gl.deleteTexture(buf.tex);
			gl.deleteFramebuffer(buf.fbo);
		}
		this.layerBuffers = [];
		if (this.mediaScratch) {
			gl.deleteTexture(this.mediaScratch.tex);
			gl.deleteFramebuffer(this.mediaScratch.fbo);
			this.mediaScratch = null;
		}
	}

	private clearTextLayerTextures() {
		for (const entry of this.textLayerTextures.values()) {
			this.gl.deleteTexture(entry.tex);
		}
		this.textLayerTextures.clear();
	}

	private clearMediaLayerTextures() {
		for (const entry of this.mediaLayerTextures.values()) {
			this.gl.deleteTexture(entry.tex);
		}
		this.mediaLayerTextures.clear();
	}

	private renderCaption(
		eff: EffectInstance,
		inputTex: WebGLTexture,
		targetFBO: WebGLFramebuffer,
	) {
		if (this.imgW <= 0 || this.imgH <= 0) return;
		const params = readCaptionParams(eff.values);
		if (!params.text.trim() || params.opacity <= 0) {
			this.drawPass(this.passthrough, targetFBO, inputTex, 1.0, 0);
			return;
		}
		// Bundled faces load async: the caption draws with a fallback and is redrawn
		// once fontsVersion() moves.
		void ensureFontLoaded(params.fontFamily);

		const tex = this.upsertOverlayTexture(
			this.captionTextures,
			eff.instanceId,
			captionSignature(params, this.imgW, this.imgH, fontsVersion()),
			(canvas, w, h) => drawCaptionToCanvas(canvas, w, h, params),
			() => (this.captionCanvas ??= document.createElement("canvas")),
		);

		this.compositeOverlayToFBO(
			inputTex,
			tex,
			targetFBO,
			params.opacity,
			params.blendMode,
		);
	}

	private renderTracking(
		eff: EffectInstance,
		inputTex: WebGLTexture,
		targetFBO: WebGLFramebuffer,
		time: number,
	) {
		if (this.imgW <= 0 || this.imgH <= 0) return;
		const params = readTrackingParams(eff.values);
		const state = this.getTrackingState(eff.instanceId);

		// Re-analyze on a fixed cadence in animation-time so preview and export stay
		// deterministic. 0.12 s is about 8 Hz: fluid motion, cheap 96-px readback.
		const interval = 0.12;
		if (state.lastAnalyze < 0 || time < state.lastAnalyze) {
			// First frame or time reset: blocking analyze so a single-frame render
			// shows a populated HUD.
			this.abortPendingSaliency(true);
			this.analyzeSaliencySync(state, params, inputTex, time);
			state.lastAnalyze = time;
		} else {
			// Steady state: collect the previous async readback once its fence signals, then
			// start the next on cadence. The ~1-frame latency is invisible at 8 Hz.
			this.pollSaliency();
			if (time - state.lastAnalyze >= interval && !this.salFence) {
				this.startSaliencyRead(state, params, inputTex, time);
				state.lastAnalyze = time;
			}
		}
		syncBoxes(state, params, time);
		const trackingW = Math.max(1, Math.round(this.imgW * 0.5));
		const trackingH = Math.max(1, Math.round(this.imgH * 0.5));
		const frame = resolveFrame(state, params, time, trackingW, trackingH);

		// The 2D-canvas redraw and texture upload are the expensive part. Render at half
		// resolution (plenty for thin HUD strokes) and skip both when the HUD is identical.
		const gl = this.gl;
		const sig =
			eff.instanceId +
			"|" +
			trackingFrameSignature(frame, params, time, trackingW, trackingH);
		const texValid =
			this.trackingTexture !== null &&
			this.trackingTexW === trackingW &&
			this.trackingTexH === trackingH;
		if (!texValid || sig !== this.lastTrackingSig) {
			if (!this.trackingCanvas) {
				this.trackingCanvas = document.createElement("canvas");
			}
			drawTrackingToCanvas(
				this.trackingCanvas,
				trackingW,
				trackingH,
				frame,
				params,
				time,
			);
			if (!texValid) {
				if (this.trackingTexture) gl.deleteTexture(this.trackingTexture);
				this.trackingTexture = this.createTexture(trackingW, trackingH);
				gl.bindTexture(gl.TEXTURE_2D, this.trackingTexture);
				gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
				gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
				this.trackingTexW = trackingW;
				this.trackingTexH = trackingH;
			}
			gl.bindTexture(gl.TEXTURE_2D, this.trackingTexture);
			gl.texSubImage2D(
				gl.TEXTURE_2D,
				0,
				0,
				0,
				gl.RGBA,
				gl.UNSIGNED_BYTE,
				this.trackingCanvas,
			);
			this.lastTrackingSig = sig;
		}

		this.compositeOverlayToFBO(
			inputTex,
			this.trackingTexture!,
			targetFBO,
			params.opacity,
		);
	}

	destroy() {
		const gl = this.gl;
		if (this.sourceTexture) gl.deleteTexture(this.sourceTexture);
		if (this.trackingTexture) gl.deleteTexture(this.trackingTexture);
		this.trackingTexture = null;
		this.clearCaptionTextures();
		this.clearTextLayerTextures();
		this.clearMediaLayerTextures();
		this.deleteLayerBuffers();
		this.abortPendingSaliency();
		if (this.salTexture) gl.deleteTexture(this.salTexture);
		this.salTexture = null;
		if (this.salFBO) gl.deleteFramebuffer(this.salFBO);
		this.salFBO = null;
		if (this.salPBO) gl.deleteBuffer(this.salPBO);
		this.salPBO = null;
		this.trackingStates.clear();
		if (this.textBlendProgram) gl.deleteProgram(this.textBlendProgram.program);
		this.textBlendProgram = null;
		if (this.layerTransformProgram) {
			gl.deleteProgram(this.layerTransformProgram.program);
		}
		this.layerTransformProgram = null;
		if (this.altSourceTexture) gl.deleteTexture(this.altSourceTexture);
		this.altSourceTexture = null;
		this.deleteStageBuffer();
		this.deleteTexturePair(this.ppTextures);
		this.deleteFBOPair(this.ppFBOs);
		if (this.fbTexture) gl.deleteTexture(this.fbTexture);
		if (this.fbFBO) gl.deleteFramebuffer(this.fbFBO);
		this.deleteTexturePair(this.hdrTextures);
		this.deleteFBOPair(this.hdrFBOs);
		this.deleteTexturePair(this.sceneTextures);
		this.deleteFBOPair(this.sceneFBOs);
		if (this.blendTexture) gl.deleteTexture(this.blendTexture);
		if (this.blendFBO) gl.deleteFramebuffer(this.blendFBO);
		this.deleteStackBuffers();
		for (const prog of this.transitionPrograms.values()) {
			gl.deleteProgram(prog.program);
		}
		this.transitionPrograms.clear();
		gl.deleteProgram(this.passthrough.program);
		for (const pair of this.fxFeedback.values()) {
			this.deleteTexturePair(pair.textures);
			this.deleteFBOPair(pair.fbos);
		}
		this.fxFeedback.clear();
		if (this.spectrumTexture) gl.deleteTexture(this.spectrumTexture);
		this.spectrumTexture = null;
		for (const entry of this.compiled.values()) {
			gl.deleteProgram(entry.program.program);
			if (entry.prePasses) {
				for (const pp of entry.prePasses) gl.deleteProgram(pp.program.program);
			}
		}
		this.compiled.clear();
		this.warmCancelled = true;
		gl.deleteVertexArray(this.quadVAO);
		gl.getExtension("WEBGL_lose_context")?.loseContext();
	}

	/** One texel per FFT bin, R8. Rewritten per audio-bars instance as the chain is
	 * walked, so each can follow the audio with its own Smoothing. */
	private spectrumTexture: WebGLTexture | null = null;
	private spectrumW = 0;
	private spectrumTime = -1;
	/** This frame's normalized bins, held until the chain walk consumes them. */
	private spectrumFrame: Uint8Array | null = null;
	private spectrumDt = 0;
	/** Bumped once per setSpectrum, so a chain walked twice in one frame (a transition
	 * blend, stacked lanes) doesn't step the followers twice. */
	private spectrumSerial = 0;
	private spectrumSmoothed = new Map<
		string,
		{ buf: Uint8Array; serial: number }
	>();
	private static readonly SILENCE = new Uint8Array(1);

	/** Beat position of the frame being rendered, or null when no BPM is known. */
	private beatPhase: number | null = null;
	private beatsPerSecond = 0;

	/** Hand the renderer this frame's place on the song's beat grid, in beats from
	 * the grid's origin. Like `setSpectrum`, both drivers must keep calling it. */
	setBeat(beats: number | null, beatsPerSecond = 0): void {
		this.beatPhase = beats;
		this.beatsPerSecond = beatsPerSecond;
	}

	/** Hand the renderer this frame's FFT bins. Both drivers must keep calling it or a
	 * visualizer would preview and export differently. Null uploads silence. */
	setSpectrum(data: Uint8Array | null, time: number): void {
		// Its own clock, not frameDelta's: that one is consumed by render() and
		// reading it here would leave the effect chain with a zero delta.
		const raw = this.spectrumTime >= 0 ? time - this.spectrumTime : 0;
		this.spectrumTime = time;
		this.spectrumDt = raw > 0 && raw < 0.5 ? raw : 0;
		this.spectrumFrame = normalizeSpectrum(data, this.spectrumDt);
		this.spectrumSerial++;
		this.uploadSpectrumTexture(this.spectrumFrame);
	}

	/** Re-point the shared texture at `data`, resizing it if the bin count moved. */
	private uploadSpectrumTexture(data: Uint8Array | null): void {
		const gl = this.gl;
		const payload =
			data && data.length > 0 ? data : (GlRenderer.SILENCE as Uint8Array);
		const width = payload.length;
		if (!this.spectrumTexture || this.spectrumW !== width) {
			if (this.spectrumTexture) gl.deleteTexture(this.spectrumTexture);
			this.spectrumTexture = gl.createTexture()!;
			this.spectrumW = width;
			gl.bindTexture(gl.TEXTURE_2D, this.spectrumTexture);
			gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
			gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
			gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
			gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
			gl.texStorage2D(gl.TEXTURE_2D, 1, gl.R8, width, 1);
		} else {
			gl.bindTexture(gl.TEXTURE_2D, this.spectrumTexture);
		}
		// A single row of bytes: the default 4-byte row alignment would misread
		// any bin count that isn't a multiple of four.
		gl.pixelStorei(gl.UNPACK_ALIGNMENT, 1);
		gl.texSubImage2D(
			gl.TEXTURE_2D,
			0,
			0,
			0,
			width,
			1,
			gl.RED,
			gl.UNSIGNED_BYTE,
			payload as Uint8Array<ArrayBuffer>,
		);
		gl.pixelStorei(gl.UNPACK_ALIGNMENT, 4);
	}

	/** Put this instance's own envelope-followed copy of the frame on the texture,
	 * right before it draws. Two Audio Bars at different Smoothing get their own follower. */
	private uploadSpectrumFor(eff: EffectInstance): void {
		const frame = this.spectrumFrame;
		if (!frame || frame.length === 0) return;
		const smoothing =
			typeof eff.values.smoothing === "number"
				? eff.values.smoothing
				: DEFAULT_AUDIO_RESPONSE.smoothing;
		let entry = this.spectrumSmoothed.get(eff.instanceId);
		if (!entry || entry.buf.length !== frame.length) {
			entry = { buf: new Uint8Array(frame.length), serial: -1 };
			this.spectrumSmoothed.set(eff.instanceId, entry);
		}
		if (entry.serial !== this.spectrumSerial) {
			entry.serial = this.spectrumSerial;
			smoothSpectrum(
				eff.instanceId,
				frame,
				entry.buf,
				this.spectrumDt,
				smoothing,
			);
		}
		// Re-uploaded even when the follower didn't step: another instance may have
		// left its own buffer on the texture since.
		this.uploadSpectrumTexture(entry.buf);
	}

	private createQuad(): WebGLVertexArrayObject {
		const gl = this.gl;
		const vao = gl.createVertexArray()!;
		gl.bindVertexArray(vao);
		const buf = gl.createBuffer()!;
		gl.bindBuffer(gl.ARRAY_BUFFER, buf);
		// prettier-ignore
		gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([
      -1, -1,  1, -1, -1,  1,
      -1,  1,  1, -1,  1,  1,
    ]), gl.STATIC_DRAW);
		gl.enableVertexAttribArray(0);
		gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);
		// Left bound: every draw in this class uses this one quad, and nothing else binds
		// a VAO on this context, so re-binding per pass was pure churn.
		return vao;
	}

	private compile(fragSource: string): CompiledProgram {
		const gl = this.gl;
		const program = createProgram(gl, VERTEX_SHADER, fragSource);
		const uniforms = getUniformLocations(gl, program);
		return { program, uniforms };
	}

	/** Effects whose shader threw once already, so don't relink them every frame. */
	private failedEffects = new Set<string>();

	/** The compiled entry for an effect, linking it on first use. Undefined for an
	 * unknown id (a stale preset) or one whose shader failed to link. */
	private effectEntry(id: string) {
		const cached = this.compiled.get(id);
		if (cached) return cached;
		const def = EFFECT_SHADERS[id as keyof typeof EFFECT_SHADERS] as
			EffectShaderDef | undefined;
		if (!def || this.failedEffects.has(id)) return undefined;
		try {
			const program = this.compile(def.fragment);
			let prePasses:
				| {
						program: CompiledProgram;
						linearFilter?: boolean;
						feedback?: boolean;
				  }[]
				| undefined;
			if (def.prePasses) {
				prePasses = def.prePasses.map((pp) => ({
					program: this.compile(pp.fragment),
					linearFilter: pp.linearFilter,
					feedback: pp.feedback,
				}));
			}
			const entry = { program, def, prePasses };
			this.compiled.set(id, entry);
			return entry;
		} catch (e) {
			console.error(`Failed to compile effect "${id}":`, e);
			this.failedEffects.add(id);
			return undefined;
		}
	}

	/** The compiled program for a transition, linking it on first use. */
	private transitionProgram(id: string): CompiledProgram | undefined {
		const cached = this.transitionPrograms.get(id);
		if (cached) return cached;
		const def = TRANSITION_SHADERS[id as keyof typeof TRANSITION_SHADERS] as
			{ fragment: string } | undefined;
		if (!def) return undefined;
		try {
			const program = this.compile(def.fragment);
			this.transitionPrograms.set(id, program);
			return program;
		} catch (e) {
			console.error(`Failed to compile transition "${id}":`, e);
			return undefined;
		}
	}

	private warmCancelled = false;

	/** Link every remaining effect and transition ahead of the first real render, a few
	 * milliseconds at a time. Yielding between slices is the point: one go blocks Firefox. */
	async warmShaders(sliceMs = 6): Promise<void> {
		const ids = [
			...Object.keys(EFFECT_SHADERS).map((id) => () => this.effectEntry(id)),
			...Object.keys(TRANSITION_SHADERS).map(
				(id) => () => this.transitionProgram(id),
			),
		];
		let slice = performance.now();
		for (const link of ids) {
			if (this.warmCancelled) return;
			link();
			if (performance.now() - slice < sliceMs) continue;
			await new Promise((r) => setTimeout(r, 0));
			slice = performance.now();
		}
	}

	private createTexture(width: number, height: number): WebGLTexture {
		const gl = this.gl;
		const tex = gl.createTexture()!;
		gl.bindTexture(gl.TEXTURE_2D, tex);
		gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.MIRRORED_REPEAT);
		gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.MIRRORED_REPEAT);
		gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
		gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
		gl.texImage2D(
			gl.TEXTURE_2D,
			0,
			gl.RGBA,
			width,
			height,
			0,
			gl.RGBA,
			gl.UNSIGNED_BYTE,
			null,
		);
		return tex;
	}

	private createHdrTexture(
		width: number,
		height: number,
		linear = true,
	): WebGLTexture {
		const gl = this.gl;
		const filter = linear ? gl.LINEAR : gl.NEAREST;
		const tex = gl.createTexture()!;
		gl.bindTexture(gl.TEXTURE_2D, tex);
		gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.MIRRORED_REPEAT);
		gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.MIRRORED_REPEAT);
		gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, filter);
		gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, filter);
		gl.texImage2D(
			gl.TEXTURE_2D,
			0,
			gl.RGBA16F,
			width,
			height,
			0,
			gl.RGBA,
			gl.HALF_FLOAT,
			null,
		);
		return tex;
	}

	private deleteTexturePair(pair: [WebGLTexture, WebGLTexture] | null) {
		if (pair) {
			this.gl.deleteTexture(pair[0]);
			this.gl.deleteTexture(pair[1]);
		}
	}

	private deleteFBOPair(pair: [WebGLFramebuffer, WebGLFramebuffer] | null) {
		if (pair) {
			this.gl.deleteFramebuffer(pair[0]);
			this.gl.deleteFramebuffer(pair[1]);
		}
	}

	/** An FBO rendering into `tex`. Null only when the context refuses to make one;
	 * an incomplete one is still returned, since draws against it fail harmlessly. */
	private createRenderTarget(tex: WebGLTexture): WebGLFramebuffer | null {
		const gl = this.gl;
		const fbo = gl.createFramebuffer();
		if (!fbo) return null;
		gl.bindFramebuffer(gl.FRAMEBUFFER, fbo);
		gl.framebufferTexture2D(
			gl.FRAMEBUFFER,
			gl.COLOR_ATTACHMENT0,
			gl.TEXTURE_2D,
			tex,
			0,
		);
		const status = gl.checkFramebufferStatus(gl.FRAMEBUFFER);
		if (
			status !== gl.FRAMEBUFFER_COMPLETE &&
			!reportedFBOStatuses.has(status)
		) {
			reportedFBOStatuses.add(status);
			console.error(`Incomplete framebuffer (status 0x${status.toString(16)})`);
		}
		gl.bindFramebuffer(gl.FRAMEBUFFER, null);
		return fbo;
	}

	private createFBOPair(
		textures: [WebGLTexture, WebGLTexture],
	): [WebGLFramebuffer, WebGLFramebuffer] {
		return [
			this.createRenderTarget(textures[0])!,
			this.createRenderTarget(textures[1])!,
		];
	}

	private setupPingPong() {
		const gl = this.gl;
		// Sized from imgW/imgH, which this call is the signal changed.
		this.deleteStageBuffer();
		this.deleteTexturePair(this.ppTextures);
		this.deleteFBOPair(this.ppFBOs);
		this.ppTextures = [
			this.createTexture(this.imgW, this.imgH),
			this.createTexture(this.imgW, this.imgH),
		];
		this.ppFBOs = this.createFBOPair(this.ppTextures);

		this.deleteLazyBuffers();
		gl.bindFramebuffer(gl.FRAMEBUFFER, null);
		for (const pair of this.fxFeedback.values()) {
			this.deleteTexturePair(pair.textures);
			this.deleteFBOPair(pair.fbos);
		}
		this.fxFeedback.clear();
	}

	private deleteLazyBuffers() {
		const gl = this.gl;
		if (this.fbTexture) {
			gl.deleteTexture(this.fbTexture);
			this.fbTexture = null;
		}
		if (this.fbFBO) {
			gl.deleteFramebuffer(this.fbFBO);
			this.fbFBO = null;
		}
		this.deleteTexturePair(this.hdrTextures);
		this.deleteFBOPair(this.hdrFBOs);
		this.hdrTextures = null;
		this.hdrFBOs = null;
		this.hdrW = 0;
		this.hdrH = 0;
		this.deleteTexturePair(this.sceneTextures);
		this.deleteFBOPair(this.sceneFBOs);
		this.sceneTextures = null;
		this.sceneFBOs = null;
		if (this.blendTexture) {
			gl.deleteTexture(this.blendTexture);
			this.blendTexture = null;
		}
		if (this.blendFBO) {
			gl.deleteFramebuffer(this.blendFBO);
			this.blendFBO = null;
		}
		this.deleteStackBuffers();
		if (this.trackingTexture) {
			gl.deleteTexture(this.trackingTexture);
			this.trackingTexture = null;
		}
		this.trackingTexW = 0;
		this.trackingTexH = 0;
		this.lastTrackingSig = "";
		this.clearCaptionTextures();
		this.clearTextLayerTextures();
		this.deleteLayerBuffers();
		this.abortPendingSaliency();
		if (this.salTexture) gl.deleteTexture(this.salTexture);
		if (this.salFBO) gl.deleteFramebuffer(this.salFBO);
		if (this.salPBO) gl.deleteBuffer(this.salPBO);
		this.salTexture = null;
		this.salFBO = null;
		this.salPBO = null;
		this.salW = 0;
		this.salH = 0;
	}

	private ensureHdrBuffers() {
		const expectedW = Math.max(1, Math.round(this.imgW / 2));
		const expectedH = Math.max(1, Math.round(this.imgH / 2));
		if (
			this.hdrTextures &&
			this.hdrFBOs &&
			this.hdrW === expectedW &&
			this.hdrH === expectedH
		) {
			return;
		}
		this.deleteTexturePair(this.hdrTextures);
		this.deleteFBOPair(this.hdrFBOs);
		this.hdrW = expectedW;
		this.hdrH = expectedH;
		this.hdrTextures = [
			this.createHdrTexture(this.hdrW, this.hdrH),
			this.createHdrTexture(this.hdrW, this.hdrH),
		];
		this.hdrFBOs = this.createFBOPair(this.hdrTextures);
	}

	private ensureSceneBuffers() {
		if (this.sceneTextures && this.sceneFBOs) return;
		this.sceneTextures = [
			this.createTexture(this.imgW, this.imgH),
			this.createTexture(this.imgW, this.imgH),
		];
		this.sceneFBOs = this.createFBOPair(this.sceneTextures);
	}

	/** Walk the stack that runs over the root chain, bottom rung first: an fx lane
	 * applies its chain to everything beneath it, a layer composites on top. */
	private renderStack(
		steps: StackStep[],
		inputTex: WebGLTexture,
		time: number,
		safeDt: number,
	): WebGLTexture {
		this.ensureStackBuffers();
		let cur = inputTex;
		// Index of the buffer `cur` lives in, or -1 while it is still the caller's
		// texture, which must never be written to.
		let curIdx = -1;

		for (const step of steps) {
			const outIdx = this.freeStackIndex(curIdx, -1);

			if (step.kind === "layer") {
				this.compositeOverlayToFBO(
					cur,
					step.layer.tex,
					this.stackFBOs![outIdx],
					step.layer.opacity,
					step.layer.blendMode,
				);
				cur = this.stackTextures![outIdx];
				curIdx = outIdx;
				continue;
			}

			const lane = step.lane;
			const outTex = this.renderChainTo(
				lane.effects,
				time,
				safeDt,
				this.stackFBOs![outIdx],
				this.stackTextures![outIdx],
				false,
				false,
				[],
				cur,
			)!;

			if (lane.weight >= 1) {
				cur = outTex;
				// renderChainTo can hand back a private feedback texture rather than the
				// buffer we named, so track where the result actually is.
				curIdx = outTex === this.stackTextures![outIdx] ? outIdx : -1;
				continue;
			}

			const mixIdx = this.freeStackIndex(curIdx, outIdx);
			this.compositeOverlayToFBO(
				cur,
				outTex,
				this.stackFBOs![mixIdx],
				lane.weight,
				"normal",
			);
			cur = this.stackTextures![mixIdx];
			curIdx = mixIdx;
		}
		return cur;
	}

	private freeStackIndex(a: number, b: number): number {
		for (let i = 0; i < 3; i++) {
			if (i !== a && i !== b) return i;
		}
		return 0;
	}

	private ensureStackBuffers() {
		if (this.stackTextures && this.stackFBOs) return;
		this.stackTextures = [];
		this.stackFBOs = [];
		for (let i = 0; i < 3; i++) {
			const tex = this.createTexture(this.imgW, this.imgH);
			this.stackTextures.push(tex);
			this.stackFBOs.push(this.createRenderTarget(tex)!);
		}
	}

	private deleteStackBuffers() {
		const gl = this.gl;
		for (const tex of this.stackTextures ?? []) gl.deleteTexture(tex);
		for (const fbo of this.stackFBOs ?? []) gl.deleteFramebuffer(fbo);
		this.stackTextures = null;
		this.stackFBOs = null;
	}

	/** Lazy: only a blend with a chain stacked over it ever needs this. */
	private ensureBlendBuffer() {
		if (this.blendTexture && this.blendFBO) return;
		this.blendTexture = this.createTexture(this.imgW, this.imgH);
		this.blendFBO = this.createRenderTarget(this.blendTexture);
	}

	private ensurePresentBuffer() {
		if (this.fbTexture && this.fbFBO) return;
		this.fbTexture = this.createTexture(this.imgW, this.imgH);
		this.fbFBO = this.createRenderTarget(this.fbTexture);
	}

	private static BLEND_MODE_VALUES: Record<TextOverlayBlendMode, number> = {
		normal: 0,
		multiply: 1,
		add: 2,
		screen: 3,
		overlay: 4,
		difference: 5,
		exclusion: 6,
		subtract: 7,
	};

	private setTextureFilter(tex: WebGLTexture, linear: boolean) {
		const gl = this.gl;
		const filter = linear ? gl.LINEAR : gl.NEAREST;
		gl.bindTexture(gl.TEXTURE_2D, tex);
		gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, filter);
		gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, filter);
	}

	private drawPass(
		compiled: CompiledProgram,
		fbo: WebGLFramebuffer | null,
		inputTex: WebGLTexture,
		flipY: number,
		time: number,
		shaderDef?: EffectShaderDef,
		values?: Record<string, number | string>,
		originalTex?: WebGLTexture,
		delta?: number,
		feedbackTex?: WebGLTexture,
		vpW?: number,
		vpH?: number,
	) {
		const gl = this.gl;

		gl.bindFramebuffer(gl.FRAMEBUFFER, fbo);
		if (fbo) {
			// vpW/vpH override for off-size render targets (half-res HDR pre-passes)
			gl.viewport(0, 0, vpW ?? this.imgW, vpH ?? this.imgH);
		} else {
			gl.viewport(0, 0, this.canvas.width, this.canvas.height);
		}

		gl.useProgram(compiled.program);

		gl.activeTexture(gl.TEXTURE0);
		gl.bindTexture(gl.TEXTURE_2D, inputTex);
		if (compiled.uniforms["u_texture"]) {
			gl.uniform1i(compiled.uniforms["u_texture"], 0);
		}
		if (compiled.uniforms["u_flipY"]) {
			gl.uniform1f(compiled.uniforms["u_flipY"], flipY);
		}
		if (compiled.uniforms["u_resolution"]) {
			gl.uniform2f(compiled.uniforms["u_resolution"], this.imgW, this.imgH);
		}
		if (compiled.uniforms["u_time"]) {
			gl.uniform1f(compiled.uniforms["u_time"], time);
		}
		if (compiled.uniforms["u_delta"] && delta !== undefined) {
			gl.uniform1f(compiled.uniforms["u_delta"], delta);
		}
		if (compiled.uniforms["u_feedback"] && this.fbTexture) {
			gl.activeTexture(gl.TEXTURE1);
			gl.bindTexture(gl.TEXTURE_2D, feedbackTex ?? this.fbTexture);
			gl.uniform1i(compiled.uniforms["u_feedback"], 1);
			gl.activeTexture(gl.TEXTURE0);
		}
		if (originalTex && compiled.uniforms["u_original"]) {
			gl.activeTexture(gl.TEXTURE3);
			gl.bindTexture(gl.TEXTURE_2D, originalTex);
			gl.uniform1i(compiled.uniforms["u_original"], 3);
			gl.activeTexture(gl.TEXTURE0);
		}
		if (compiled.uniforms["u_spectrum"]) {
			// Never leave the sampler at its default unit 0: it would read the frame
			// itself as a spectrum and paint noise.
			if (!this.spectrumTexture) this.uploadSpectrumTexture(null);
			gl.activeTexture(gl.TEXTURE5);
			gl.bindTexture(gl.TEXTURE_2D, this.spectrumTexture);
			gl.uniform1i(compiled.uniforms["u_spectrum"], 5);
			gl.activeTexture(gl.TEXTURE0);
		}

		if (shaderDef && values) {
			shaderDef.setUniforms(gl, compiled.uniforms, values);
		}

		gl.drawArrays(gl.TRIANGLES, 0, 6);
	}
}
