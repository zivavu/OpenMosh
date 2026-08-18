import {
  createAudioGraph,
  disposeAudioGraph as disposeGraph,
  computeVolumeLevel,
  applyVolumeLinksTick,
  type AudioGraphState,
} from './audio-controller';
import { resetAutoRange } from './auto-range';
import type { AudioLinkGroup } from './audio-utils';
import type { SpectrumData } from '../types';

/** Element-clock gap that reads as a jump rather than as step granularity. */
const CLOCK_RESYNC = 0.25;
/** How much of the interpolation error survives each new element reading. */
const CLOCK_DECAY = 0.8;

interface AudioManagerOptions {
  /** Every chain on screen, split by how it follows the music: the base chain
   * under the editor's response, then one group per active fx lane under its
   * own. Read per frame. */
  getLinkGroups: () => AudioLinkGroup[];
  initialOutputVolume?: number;
  initialLoop?: boolean;
}

export class AudioManager {
  // ── Track file ──
  trackFile = $state<File | null>(null);
  trackObjectUrl = $state<string | null>(null);

  // ── Audio element (set by editor via setAudioEl) ──
  #audioEl = $state<HTMLAudioElement | undefined>(undefined);

  // ── Playback ──
  trackDuration = $state(0);
  trackCurrentTime = $state(0);
  spanStart = $state(0);
  spanEnd = $state(0);
  audioPlaying = $state(false);
  loopAudio = $state(false);
  pendingSpan = $state<{ start: number; end: number } | null>(null);
  // Play as soon as the newly loaded track's metadata arrives (library play button)
  autoplayOnLoad = false;

  // ── Interpolated playback clock (see tickCurrentTime) ──
  #clockAnchor = 0;
  #clockWall = 0;
  #clockLastRaw = -1;

  // ── Audio graph ──
  audioContext = $state<AudioContext | null>(null);
  analyserNode = $state<AnalyserNode | null>(null);
  gainNode = $state<GainNode | null>(null);
  normalizeGainNode = $state<GainNode | null>(null);
  mediaSource = $state<MediaElementAudioSourceNode | null>(null);

  // ── Frequency / volume ──
  volumeLevel = $state(0);
  frequencyData = $state<Uint8Array | null>(null);
  audioSampleRate = $state(0);
  audioFrequencyBinCount = $state(0);
  outputVolume = $state(1);
  normalizeGain = $state(1.0);

  // ── Derived ──
  spectrumData: SpectrumData | null = $derived(
    this.frequencyData && this.audioSampleRate > 0 && this.audioFrequencyBinCount > 0
      ? {
          data: this.frequencyData,
          sampleRate: this.audioSampleRate,
          binCount: this.audioFrequencyBinCount,
        }
      : null,
  );

  readonly #getLinkGroups: () => AudioLinkGroup[];

  constructor({
    getLinkGroups,
    initialOutputVolume = 1,
    initialLoop = false,
  }: AudioManagerOptions) {
    this.#getLinkGroups = getLinkGroups;
    this.outputVolume = initialOutputVolume;
    this.loopAudio = initialLoop;

    // ObjectURL lifecycle
    $effect(() => {
      const f = this.trackFile;
      if (!f) {
        this.trackObjectUrl = null;
        return;
      }
      const url = URL.createObjectURL(f);
      this.trackObjectUrl = url;
      return () => URL.revokeObjectURL(url);
    });

    // Volume / frequency rAF tick
    $effect(() => {
      const analyser = this.analyserNode;
      if (!analyser) return;
      const timeData = new Uint8Array(analyser.fftSize);
      // Capture at effect-run time (preserved behavior from original editors)
      const freqDataRef = this.frequencyData;
      const sampleRate = this.audioSampleRate;
      const fftSize = analyser.fftSize;
      let rafId: number;
      let wasPaused = false;
      let lastTick = performance.now();
      const tick = () => {
        const now = performance.now();
        const dt = (now - lastTick) / 1000;
        lastTick = now;
        // Source-agnostic pause check (works for both <audio> and <video> sources,
        // unlike `audioPlaying` which only tracks the <audio> element).
        if (this.mediaSource?.mediaElement.paused) {
          if (!wasPaused) {
            // Settle to baseline once on pause, instead of freezing at the
            // last non-silent frame for the whole pause duration.
            wasPaused = true;
            this.volumeLevel = 0;
            freqDataRef?.fill(0);
            // Envelopes survive a pause; re-learning would cost dead seconds.
            for (const group of this.#getLinkGroups()) {
              applyVolumeLinksTick(
                group.effects,
                0,
                freqDataRef,
                sampleRate,
                fftSize,
                dt,
                group.response,
                group.scope,
              );
            }
          }
          rafId = requestAnimationFrame(tick);
          return;
        }
        wasPaused = false;
        this.volumeLevel = computeVolumeLevel(analyser, timeData);
        if (freqDataRef)
          analyser.getByteFrequencyData(freqDataRef as Uint8Array<ArrayBuffer>);
        for (const group of this.#getLinkGroups()) {
          applyVolumeLinksTick(
            group.effects,
            this.volumeLevel,
            freqDataRef,
            sampleRate,
            fftSize,
            dt,
            group.response,
            group.scope,
          );
        }
        rafId = requestAnimationFrame(tick);
      };
      rafId = requestAnimationFrame(tick);
      return () => cancelAnimationFrame(rafId);
    });
  }

  setAudioEl(el: HTMLAudioElement | undefined) {
    this.#audioEl = el;
  }

  ensureAudioGraph() {
    if (!this.#audioEl || this.audioContext) return;
    this.applyAudioGraphState(createAudioGraph(this.#audioEl));
  }

  applyAudioGraphState(state: AudioGraphState) {
    this.audioContext = state.context;
    this.mediaSource = state.source;
    this.normalizeGainNode = state.normalizeGain;
    this.normalizeGainNode.gain.value = this.normalizeGain;
    this.analyserNode = state.analyser;
    this.gainNode = state.gain;
    this.gainNode.gain.value = this.outputVolume;
    this.frequencyData = state.frequencyData;
    this.audioSampleRate = state.sampleRate;
    this.audioFrequencyBinCount = state.binCount;
  }

  disposeAudioGraph() {
    if (this.audioContext) disposeGraph(this.audioContext);
    this.mediaSource = null;
    this.normalizeGainNode = null;
    this.analyserNode = null;
    this.gainNode = null;
    this.frequencyData = null;
    this.audioSampleRate = 0;
    this.audioFrequencyBinCount = 0;
    this.audioContext = null;
    this.volumeLevel = 0;
  }

  onAudioLoadedMetadata() {
    const d = this.#audioEl?.duration;
    if (typeof d === 'number' && Number.isFinite(d)) {
      this.trackDuration = d;
      if (this.pendingSpan) {
        this.spanStart = Math.max(0, Math.min(this.pendingSpan.start, d));
        this.spanEnd = Math.max(0, Math.min(this.pendingSpan.end, d));
        this.pendingSpan = null;
      } else {
        this.spanStart = 0;
        this.spanEnd = d;
      }
    }
    if (this.autoplayOnLoad) {
      this.autoplayOnLoad = false;
      this.playAudio();
    }
  }

  onAudioTimeUpdate() {
    if (!this.#audioEl) return;
    // While playing the rAF tick owns trackCurrentTime; writing the coarse
    // element clock here as well would drag the playhead back every ~250 ms.
    if (!this.audioPlaying) this.trackCurrentTime = this.#audioEl.currentTime;
    if (this.audioPlaying && this.#audioEl.currentTime >= this.spanEnd) {
      this.#audioEl.currentTime = this.spanStart;
      this.trackCurrentTime = this.spanStart;
      this.#resetClock(this.spanStart);
      if (!this.loopAudio) {
        this.#audioEl.pause();
        this.audioPlaying = false;
      }
    }
  }

  onAudioEnded() {
    // Natural track end can fire before timeupdate reaches spanEnd.
    if (!this.#audioEl || !this.loopAudio) return;
    this.#audioEl.currentTime = this.spanStart;
    this.trackCurrentTime = this.spanStart;
    this.#resetClock(this.spanStart);
    this.#audioEl.play();
    this.audioPlaying = true;
  }

  playAudio() {
    if (!this.trackFile || !this.trackObjectUrl || !this.#audioEl) return;
    this.ensureAudioGraph();
    if (this.audioContext?.state === 'suspended') this.audioContext.resume();
    const t = this.#audioEl.currentTime;
    if (t < this.spanStart || t >= this.spanEnd) {
      this.#audioEl.currentTime = this.spanStart;
      this.trackCurrentTime = this.spanStart;
    }
    this.#resetClock(this.#audioEl.currentTime);
    this.#audioEl.play();
    this.audioPlaying = true;
  }

  pauseAudio() {
    this.#audioEl?.pause();
    this.audioPlaying = false;
  }

  /**
   * Pull the element clock into trackCurrentTime. The timeupdate event only
   * fires ~4 Hz, which makes playheads jump — call this from a rAF loop while
   * playing for smooth movement.
   *
   * `currentTime` itself is coarse: browsers advance it in audio-buffer steps
   * (tens of ms), so reading it per frame still steps. Between steps the wall
   * clock carries the estimate forward from the last reading, and each new
   * reading re-anchors it, bleeding off the error rather than snapping — a snap
   * is the stutter we're avoiding.
   */
  tickCurrentTime() {
    const el = this.#audioEl;
    if (!el || !this.audioPlaying) return;
    const now = performance.now() / 1000;
    const rate = el.playbackRate || 1;
    const raw = el.currentTime;

    if (raw !== this.#clockLastRaw) {
      this.#clockLastRaw = raw;
      const predicted = this.#clockAnchor + (now - this.#clockWall) * rate;
      this.#clockWall = now;
      // A seek, a loop or a stall puts the estimate somewhere else entirely;
      // anything smaller is the step granularity and gets absorbed.
      this.#clockAnchor =
        Math.abs(predicted - raw) > CLOCK_RESYNC
          ? raw
          : raw + (predicted - raw) * CLOCK_DECAY;
    }

    const est = this.#clockAnchor + (now - this.#clockWall) * rate;
    // The estimate leads the element clock by a few ms, which at the very end
    // of a track would read as a time past the end.
    this.trackCurrentTime =
      this.trackDuration > 0 ? Math.min(est, this.trackDuration) : est;
  }

  /** Drop the interpolated clock onto `t` — after a seek, a loop or a pause. */
  #resetClock(t: number) {
    this.#clockAnchor = t;
    this.#clockWall = performance.now() / 1000;
    this.#clockLastRaw = -1;
  }

  seekTo(t: number) {
    if (!this.#audioEl) return;
    const clamped = Math.max(0, Math.min(this.trackDuration, t));
    this.#audioEl.currentTime = clamped;
    this.trackCurrentTime = clamped;
    this.#resetClock(clamped);
    resetAutoRange();
  }

  clearTrack() {
    resetAutoRange();
    this.#audioEl?.pause();
    this.audioPlaying = false;
    this.autoplayOnLoad = false;
    this.trackFile = null;
    this.trackDuration = 0;
    this.trackCurrentTime = 0;
    this.spanStart = 0;
    this.spanEnd = 0;
    this.pendingSpan = null;
    this.normalizeGain = 1.0;
    this.disposeAudioGraph();
  }

  setOutputVolume(v: number) {
    this.outputVolume = v;
    if (this.gainNode) this.gainNode.gain.value = v;
  }

  setNormalizeGain(v: number) {
    // Stored so graphs created later (they're built lazily on play) pick it up.
    this.normalizeGain = v;
    if (this.normalizeGainNode) this.normalizeGainNode.gain.value = v;
  }

  resetPlayback() {
    this.#audioEl?.pause();
    this.audioPlaying = false;
    this.trackCurrentTime = 0;
    this.spanStart = 0;
    this.spanEnd = 0;
    this.pendingSpan = null;
  }
}
