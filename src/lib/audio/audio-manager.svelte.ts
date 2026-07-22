import {
  createAudioGraph,
  disposeAudioGraph as disposeGraph,
  computeVolumeLevel,
  applyVolumeLinksTick,
  type AudioGraphState,
} from './audio-controller';
import type { EffectInstance } from '../effects';
import type { SpectrumData } from '../types';

interface AudioManagerOptions {
  getEffects: () => EffectInstance[];
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

  readonly #getEffects: () => EffectInstance[];

  constructor({ getEffects, initialOutputVolume = 1, initialLoop = false }: AudioManagerOptions) {
    this.#getEffects = getEffects;
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
      const tick = () => {
        // Source-agnostic pause check (works for both <audio> and <video> sources,
        // unlike `audioPlaying` which only tracks the <audio> element).
        if (this.mediaSource?.mediaElement.paused) {
          if (!wasPaused) {
            // Settle to baseline once on pause, instead of freezing at the
            // last non-silent frame for the whole pause duration.
            wasPaused = true;
            this.volumeLevel = 0;
            freqDataRef?.fill(0);
            applyVolumeLinksTick(this.#getEffects(), 0, freqDataRef, sampleRate, fftSize);
          }
          rafId = requestAnimationFrame(tick);
          return;
        }
        wasPaused = false;
        this.volumeLevel = computeVolumeLevel(analyser, timeData);
        if (freqDataRef)
          analyser.getByteFrequencyData(freqDataRef as Uint8Array<ArrayBuffer>);
        applyVolumeLinksTick(
          this.#getEffects(),
          this.volumeLevel,
          freqDataRef,
          sampleRate,
          fftSize,
        );
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
    if (this.audioContext) {
      disposeGraph({
        context: this.audioContext,
        source: this.mediaSource!,
        normalizeGain: this.normalizeGainNode!,
        analyser: this.analyserNode!,
        gain: this.gainNode!,
        frequencyData: this.frequencyData!,
        sampleRate: this.audioSampleRate,
        binCount: this.audioFrequencyBinCount,
      });
    }
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
    this.trackCurrentTime = this.#audioEl.currentTime;
    if (this.audioPlaying && this.#audioEl.currentTime >= this.spanEnd) {
      this.#audioEl.currentTime = this.spanStart;
      this.trackCurrentTime = this.spanStart;
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
   */
  tickCurrentTime() {
    if (!this.#audioEl || !this.audioPlaying) return;
    this.trackCurrentTime = this.#audioEl.currentTime;
  }

  seekTo(t: number) {
    if (!this.#audioEl) return;
    const clamped = Math.max(0, Math.min(this.trackDuration, t));
    this.#audioEl.currentTime = clamped;
    this.trackCurrentTime = clamped;
  }

  clearTrack() {
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
