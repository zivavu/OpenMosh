import type { GlRenderer } from "../gl/renderer";
import { SlideVideoSampler } from "../slideshow/video-sampler";
import type { SequenceSource } from "./sequence-sources.svelte";

/**
 * Export-side twin of `SequenceFrameDriver`. Same state machine — the caller
 * states where in the clip each segment wants to be — but every upload is
 * awaited, so the recorder writes the exact frame rather than whatever the
 * decoder happened to have ready.
 *
 * Samplers are created here rather than borrowed from the preview registry:
 * the preview's are parked at arbitrary positions, and an export must not
 * depend on where the user last left the playhead.
 */
/** Mirrors the preview registry's cap. */
const MAX_DECODED_IMAGES = 16;

export interface SequenceExportSources {
	/**
	 * Upload the frame for `sourceId`, taking a video source to `sourceTime`
	 * seconds into its clip. No source clears the texture to black.
	 */
	advance(sourceId: string | undefined, sourceTime: number): Promise<void>;
	/**
	 * Upload the outgoing side of a transition into the renderer's second source
	 * texture. `null` releases it.
	 */
	advanceOutgoing(
		sourceId: string | null | undefined,
		sourceTime: number,
	): Promise<void>;
	dispose(): void;
}

export async function createSequenceExportSources(
	sources: SequenceSource[],
	renderer: GlRenderer,
): Promise<SequenceExportSources> {
	const byId = new Map(sources.map((s) => [s.id, s]));

	const images = new Map<string, HTMLImageElement>();
	const samplers = new Map<string, SlideVideoSampler>();

	// Videos are opened up front — creating a decoder mid-export would stall the
	// frame it happens on. Images are decoded on first use instead: a pool can
	// hold hundreds, and holding every full-resolution bitmap for the length of
	// an export is what actually runs the tab out of memory.
	await Promise.all(
		sources
			.filter((src) => src.kind === "video")
			.map(async (src) => {
				const sampler = await SlideVideoSampler.create(src.file);
				if (sampler) samplers.set(src.id, sampler);
			}),
	);

	/** Unknown at first: the preview left whatever it was showing on the
	 * texture, so the first frame clears or uploads either way. */
	let currentId: string | null | undefined = undefined;
	let outgoingId: string | null = null;

	/** Shared by both sides; `images` is the cache, bounded below. */
	async function resolveImage(
		src: SequenceSource,
	): Promise<HTMLImageElement | null> {
		const hit = images.get(src.id);
		if (hit) return hit;
		const decoded = await decodeImage(src.objectUrl);
		if (!decoded) return null;
		images.set(src.id, decoded);
		if (images.size > MAX_DECODED_IMAGES) {
			const oldest = images.keys().next().value;
			if (oldest !== undefined && oldest !== src.id) images.delete(oldest);
		}
		return decoded;
	}

	return {
		async advance(sourceId, sourceTime) {
			const src = sourceId ? byId.get(sourceId) : undefined;
			if (!src) {
				if (currentId !== null) {
					currentId = null;
					renderer.clearSource();
				}
				return;
			}

			if (src.kind === "image") {
				if (currentId !== src.id) {
					const img = await resolveImage(src);
					if (!img) return;
					renderer.updateSourceImage(img);
					currentId = src.id;
				}
				return;
			}

			const sampler = samplers.get(src.id);
			if (!sampler) return;
			currentId = src.id;
			const frame = await sampler.at(sourceTime);
			if (frame) {
				renderer.updateSourceFrame(frame);
				frame.close();
			}
		},
		async advanceOutgoing(sourceId, sourceTime) {
			if (!sourceId) {
				if (outgoingId !== null) {
					outgoingId = null;
					renderer.clearAltSource();
				}
				return;
			}
			const src = byId.get(sourceId);
			if (!src) return;

			if (src.kind === "image") {
				if (outgoingId !== src.id) {
					const img = await resolveImage(src);
					if (!img) return;
					renderer.updateAltSourceImage(img);
					outgoingId = src.id;
				}
				return;
			}

			const sampler = samplers.get(src.id);
			if (!sampler) return;
			// Measured from the outgoing segment's start, so the clip carries on past
			// the boundary instead of restarting under the fade.
			outgoingId = src.id;
			const frame = await sampler.at(sourceTime);
			if (frame) {
				renderer.updateAltSourceFrame(frame);
				frame.close();
			}
		},
		dispose() {
			for (const s of samplers.values()) s.dispose();
			samplers.clear();
			images.clear();
		},
	};
}

function decodeImage(url: string): Promise<HTMLImageElement | null> {
	return new Promise((resolve) => {
		const img = new Image();
		img.crossOrigin = "anonymous";
		img.onload = () => resolve(img);
		img.onerror = () => resolve(null);
		img.src = url;
	});
}
