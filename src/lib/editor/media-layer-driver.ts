import type { GlRenderer } from "../gl/renderer";
import type { ResolvedMediaLayer } from "../media";
import { SlideVideoSampler } from "../slideshow/video-sampler";
import { PREVIEW_MAX_PIXELS } from "../video/decode";
import type { SequenceSourceRegistry } from "./sequence-sources.svelte";

export interface MediaLayerDriverOptions {
  registry: SequenceSourceRegistry;
  /** Read per call: the renderer is rebuilt on WebGL context loss. */
  getRenderer: () => GlRenderer | null;
  /** Called once a late upload lands, so a paused preview can redraw. */
  onUpload?: () => void;
}

/**
 * Uploads the frame each visible media layer wants, keyed by lane. The lane's
 * clip states where in its source it is, so what a layer shows at a given
 * master time never depends on how playback got there — and matches what the
 * export writes.
 *
 * Video layers get a sampler each, keyed by lane *and* source rather than by
 * source alone. A sampler decodes sequentially from wherever it is and drops
 * overlapping `at()` calls, so two lanes sharing one — or a lane sharing the
 * segment driver's — would each be handed the other's position. The source is
 * in the key too because a lane's clips can name different videos, and a lane
 * that kept one decoder would reopen it at every cut.
 */
export class MediaLayerDriver {
  #registry: SequenceSourceRegistry;
  #getRenderer: () => GlRenderer | null;
  #onUpload: (() => void) | undefined;

  /** Source whose frame is on each lane's texture, keyed by lane id. */
  #uploaded = new Map<string, string>();
  /** One decoder per (lane, video source), keyed by `samplerKey`. */
  #samplers = new Map<string, SlideVideoSampler>();
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
    for (const layer of layers) {
      const src = this.#registry.get(layer.sourceId);
      if (!src) {
        this.#release(layer.key);
        continue;
      }

      if (src.kind === "image") {
        // Still media only re-uploads when the lane's source changes; a photo
        // layer costs nothing per frame after the first. Checked against the
        // renderer, not this latch alone: it collects a lane's texture as soon
        // as the lane stops resolving — hidden, or simply between two clips —
        // and a latch that only tracked the source id would then skip the
        // upload that has to bring it back.
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

      const sampler = this.#samplerFor(layer.key, src.id, src.file);
      if (!sampler) continue;
      this.#uploaded.set(layer.key, src.id);
      // Non-blocking: a lane whose decoder has nothing new keeps the frame
      // already on its texture rather than making every other lane wait on it.
      void sampler.at(layer.sourceTime, false).then((frame) => {
        if (!frame) return;
        if (!this.#disposed) {
          this.#getRenderer()?.updateLayerFrame(layer.key, frame);
          this.#onUpload?.();
        }
        frame.close();
      });
    }
    // Lanes that stopped asking for frames drop theirs; the renderer collects
    // the textures on its own once they leave the resolved set. The decoders
    // are kept: a lane between two clips is about to want its own back, and
    // reopening one mid-playback stalls the frame it happens on.
    for (const key of this.#uploaded.keys()) {
      if (!layers.some((l) => l.key === key)) this.#uploaded.delete(key);
    }
  }

  /**
   * This lane's decoder for this source, opening one as needed. Kept once open:
   * a lane that cuts back and forth between two videos would otherwise pay a
   * decoder open on every clip edge. The per-lane cap is what stops a lane with
   * a dozen video clips from holding a dozen decoders.
   */
  #samplerFor(
    key: string,
    sourceId: string,
    file: File,
  ): SlideVideoSampler | undefined {
    const id = samplerKey(key, sourceId);
    const held = this.#samplers.get(id);
    if (held) {
      // Re-inserted so the map's iteration order is least-recently-used first.
      this.#samplers.delete(id);
      this.#samplers.set(id, held);
      return held;
    }
    if (this.#creating.has(id)) return undefined;
    this.#creating.add(id);
    void SlideVideoSampler.create(file, PREVIEW_MAX_PIXELS).then((sampler) => {
      this.#creating.delete(id);
      if (!sampler) return;
      if (this.#disposed) {
        sampler.dispose();
        return;
      }
      this.#samplers.set(id, sampler);
      this.#evict(key);
    });
    return undefined;
  }

  /** Retire this lane's coldest decoders once it holds more than the cap. */
  #evict(key: string) {
    const mine = [...this.#samplers.keys()].filter((k) => laneOfKey(k) === key);
    for (const id of mine.slice(0, mine.length - MAX_LANE_SAMPLERS)) {
      this.#samplers.get(id)?.dispose();
      this.#samplers.delete(id);
    }
  }

  #release(key: string) {
    for (const [id, sampler] of this.#samplers) {
      if (laneOfKey(id) !== key) continue;
      sampler.dispose();
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
    for (const sampler of this.#samplers.values()) sampler.dispose();
    this.#samplers.clear();
  }
}

/**
 * How many decoders one lane may hold at once. A lane shows one clip at a time,
 * so anything past the handful it cuts between is memory spent on video the
 * playhead left behind.
 */
const MAX_LANE_SAMPLERS = 4;

/** Lane ids are generated with no "|" in them, so this splits cleanly. */
function samplerKey(laneKey: string, sourceId: string): string {
  return `${laneKey}|${sourceId}`;
}

function laneOfKey(key: string): string {
  return key.slice(0, key.lastIndexOf("|"));
}
