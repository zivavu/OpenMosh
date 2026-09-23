import type { GlRenderer } from "../gl/renderer";
import { mediaLayerSides, type ResolvedMediaLayer } from "../media";
import { SlideVideoSampler } from "../slideshow/video-sampler";
import type { SequenceSourceRegistry } from "./sequence-sources.svelte";

export interface MediaLayerDriverOptions {
	registry: SequenceSourceRegistry;
	/** Read per call: the renderer is rebuilt on WebGL context loss. */
	getRenderer: () => GlRenderer | null;
	/** Called once a late upload lands, so a paused preview can redraw. */
	onUpload?: () => void;
}

/** Uploads the frame each visible media layer wants, keyed by lane. */
export class MediaLayerDriver {
	#registry: SequenceSourceRegistry;
	#getRenderer: () => GlRenderer | null;
	#onUpload: (() => void) | undefined;

	/** Source whose frame is on each lane's texture, keyed by lane id. */
	#uploaded = new Map<string, string>();
	/** One decoder per (lane, video source), keyed by `samplerKey`. */
	#samplers = new Map<string, { sampler: SlideVideoSampler; file: File }>();
	/** Keys whose sampler is still being created, so we don't start a second. */
	#creating = new Set<string>();
	#disposed = false;

	constructor(opts: MediaLayerDriverOptions) {
		this.#registry = opts.registry;
		this.#getRenderer = opts.getRenderer;
		this.#onUpload = opts.onUpload;
	}

	advance(layers: ResolvedMediaLayer[]) {
		if (this.#disposed) return;
		const renderer = this.#getRenderer();
		const sides = mediaLayerSides(layers);
		for (const layer of sides) {
			const src = this.#registry.get(layer.sourceId);
			if (!src) {
				this.#release(layer.key);
				continue;
			}

			if (src.kind === "image") {
				// Still media only re-uploads when the lane's source changes.
				if (
					this.#uploaded.get(layer.key) === src.id &&
					renderer?.hasLayerTexture(layer.key)
				) {
					continue;
				}
				const img = this.#registry.image(src.id);
				if (img?.complete) {
					this.#getRenderer()?.updateLayerImage(layer.key, img);
					this.#uploaded.set(layer.key, src.id);
				}
				continue;
			}

			const sampler = this.#samplerFor(
				layer.key,
				src.id,
				src.proxyFile ?? src.file,
			);
			if (!sampler) continue;
			const { key } = layer;
			const wanted = src.id;
			this.#uploaded.set(key, wanted);
			// Non-blocking: a lane whose decoder has nothing new keeps its current frame.
			void sampler.at(layer.sourceTime, false).then((frame) => {
				if (!frame) return;
				// A request that outlived the clip it was made for.
				if (!this.#disposed && this.#uploaded.get(key) === wanted) {
					this.#getRenderer()?.updateLayerFrame(key, frame);
					this.#onUpload?.();
				}
				frame.close();
			});
		}
		// Lanes that stopped asking for frames drop theirs; decoders are kept for a later clip.
		for (const key of this.#uploaded.keys()) {
			if (!sides.some((l) => l.key === key)) this.#uploaded.delete(key);
		}
	}

	/** This lane's decoder for this source, opening one as needed. */
	#samplerFor(
		key: string,
		sourceId: string,
		file: File,
	): SlideVideoSampler | undefined {
		const id = samplerKey(key, sourceId);
		const held = this.#samplers.get(id);
		if (held) {
			if (held.file !== file) {
				held.sampler.dispose();
				this.#samplers.delete(id);
			} else {
				// Re-inserted so the map's iteration order is least-recently-used first.
				this.#samplers.delete(id);
				this.#samplers.set(id, held);
				return held.sampler;
			}
		}
		if (this.#creating.has(id)) return undefined;
		this.#creating.add(id);
		void SlideVideoSampler.create(file).then((sampler) => {
			this.#creating.delete(id);
			if (!sampler) return;
			if (this.#disposed) {
				sampler.dispose();
				return;
			}
			this.#samplers.set(id, { sampler, file });
			this.#evict(key);
			// A paused canvas only redraws when told to.
			this.#onUpload?.();
		});
		return undefined;
	}

	/** Retire this lane's coldest decoders once it holds more than the cap. */
	#evict(key: string) {
		const mine = [...this.#samplers.keys()].filter((k) => laneOfKey(k) === key);
		for (const id of mine.slice(0, mine.length - MAX_LANE_SAMPLERS)) {
			this.#samplers.get(id)?.sampler.dispose();
			this.#samplers.delete(id);
		}
	}

	#release(key: string) {
		for (const [id, held] of this.#samplers) {
			if (laneOfKey(id) !== key) continue;
			held.sampler.dispose();
			this.#samplers.delete(id);
		}
		if (!this.#uploaded.delete(key)) return;
		this.#getRenderer()?.dropLayerTexture(key);
	}

	/** Force the next call to re-upload, e.g. after the renderer was rebuilt. */
	invalidate() {
		this.#uploaded.clear();
	}

	dispose() {
		this.#disposed = true;
		for (const { sampler } of this.#samplers.values()) sampler.dispose();
		this.#samplers.clear();
	}
}

/** How many decoders one lane may hold at once. */
const MAX_LANE_SAMPLERS = 4;

/** Lane ids are generated with no "|" in them, so this splits cleanly. */
function samplerKey(laneKey: string, sourceId: string): string {
	return `${laneKey}|${sourceId}`;
}

function laneOfKey(key: string): string {
	return key.slice(0, key.lastIndexOf("|"));
}
