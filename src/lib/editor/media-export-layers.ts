import type { GlRenderer } from "../gl/renderer";
import { mediaLayerSides, type ResolvedMediaLayer } from "../media";
import { SlideVideoSampler } from "../slideshow/video-sampler";
import type { SequenceSource } from "./sequence-sources.svelte";

/** Export-side twin of `MediaLayerDriver`, but every upload is awaited. */
export interface MediaExportLayers {
	/** Upload every layer in this frame's set. */
	advance(layers: ResolvedMediaLayer[]): Promise<void>;
	dispose(): void;
}

export async function createMediaExportLayers(
	sources: SequenceSource[],
	/** Every source a lane's clips can call for, keyed by lane id. */
	laneSources: Map<string, string[]>,
	renderer: GlRenderer,
): Promise<MediaExportLayers> {
	const byId = new Map(sources.map((s) => [s.id, s]));

	const images = new Map<string, HTMLImageElement>();
	/** One decoder per (lane, video source); a sampler decodes from its own position. */
	const samplers = new Map<string, SlideVideoSampler>();
	/** Source whose frame is on each lane's texture, keyed by lane. */
	const uploaded = new Map<string, string>();

	// Opened up front: creating a decoder mid-export would stall the frame it happens on.
	await Promise.all(
		[...laneSources].flatMap(([laneId, sourceIds]) =>
			sourceIds.map(async (sourceId) => {
				const src = byId.get(sourceId);
				if (!src) return;
				if (src.kind === "video") {
					const sampler = await SlideVideoSampler.create(src.file);
					if (sampler) samplers.set(samplerKey(laneId, src.id), sampler);
					return;
				}
				if (images.has(src.id)) return;
				const img = await decodeImage(src.objectUrl);
				if (img) images.set(src.id, img);
			}),
		),
	);

	/** A blend's second texture opens its decoders on first use. */
	const samplerFor = async (key: string, file: File, sourceId: string) => {
		const id = samplerKey(key, sourceId);
		if (!samplers.has(id)) {
			const sampler = await SlideVideoSampler.create(file);
			if (sampler) samplers.set(id, sampler);
		}
		return samplers.get(id);
	};

	return {
		async advance(layers) {
			// Run the lanes together rather than in series: each holds its own decoder and texture.
			await Promise.all(
				mediaLayerSides(layers).map(async (layer) => {
					const src = byId.get(layer.sourceId);
					if (!src) return;

					if (src.kind === "image") {
						// Same as the preview driver: the renderer collects a lane's texture when it stops resolving.
						if (
							uploaded.get(layer.key) === src.id &&
							renderer.hasLayerTexture(layer.key)
						) {
							return;
						}
						const img = images.get(src.id);
						if (!img) return;
						renderer.updateLayerImage(layer.key, img);
						uploaded.set(layer.key, src.id);
						return;
					}

					const sampler = await samplerFor(layer.key, src.file, src.id);
					if (!sampler) return;
					uploaded.set(layer.key, src.id);
					const frame = await sampler.at(layer.sourceTime);
					if (frame) {
						renderer.updateLayerFrame(layer.key, frame);
						frame.close();
					}
				}),
			);
		},
		dispose() {
			for (const s of samplers.values()) s.dispose();
			samplers.clear();
			images.clear();
			uploaded.clear();
		},
	};
}

function samplerKey(laneId: string, sourceId: string): string {
	return `${laneId}|${sourceId}`;
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
