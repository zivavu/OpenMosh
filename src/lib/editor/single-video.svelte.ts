/** Single mode's video: a WebCodecs preview player where it can build one, with the
 * hidden `<video>` element as the fallback and the recording source. Owns the span,
 * the speed and the playhead. Effects run, so construct it during component init. */

import { untrack } from "svelte";
import {
	createAudioGraph,
	createOutputAudioGraph,
} from "../audio/audio-controller";
import type { AudioManager } from "../audio/audio-manager.svelte";
import { showToast } from "../components/ui/toast.svelte";
import { VideoPreviewPlayer } from "../video-preview/preview-player.svelte";

/** Positions this close to the span end count as "at the end". */
export const VIDEO_END_EPSILON = 0.1;

export interface SingleVideoHost {
	audio(): AudioManager;
	file(): File | null;
	isVideo(): boolean;
	/** The preview proxy standing in for the file, once it's built and wanted. */
	proxyFor(file: File): File | null;
	naturalSize(): { width?: number; height?: number };
	recordDuration(): number;
	setRecordDuration(seconds: number): void;
	recording(): boolean;
	loop(): boolean;
	/** Where play starts when the timeline's marker owns it; null plays from the span. */
	markerTime(): number | null;
}

export class SingleVideo {
	readonly #host: SingleVideoHost;

	el = $state<HTMLVideoElement | null>(null);
	duration = $state(0);
	/** The element's own playhead; the player keeps its own. */
	elementTime = $state(0);
	elementPlaying = $state(false);
	spanStart = $state(0);
	spanEnd = $state(0);
	speed = $state(1);
	/** The clock sits past the span end. */
	pastSpan = $state(false);
	// Starts false: Firefox ignores playbackRate on element-captured audio (moz bug 1517199).
	hasAudio = $state(false);
	player = $state<VideoPreviewPlayer | null>(null);
	/** Which of the two ways to play the video gave up on it. */
	unplayable = $state({ player: false, element: false });
	/** Set by the first play, a user gesture, so the audio graph can start unblocked. */
	audioUnlocked = $state(false);

	clock = $derived.by(() =>
		this.player ? this.player.currentTime : this.elementTime,
	);
	isPlaying = $derived.by(() =>
		this.player ? this.player.playing : this.elementPlaying,
	);

	/** The file the current player was built for, so the proxy swap can compare. */
	#playerFile: File | null = null;
	/** The last player as its effect tore down; the teardown runs before the next body. */
	#lastPlayer: {
		time: number;
		playing: boolean;
		width: number;
		height: number;
	} | null = null;

	constructor(host: SingleVideoHost) {
		this.#host = host;
		$effect(() => this.#buildPlayer());
		$effect(() => {
			if (!this.unplayable.player || !this.unplayable.element) return;
			const name = untrack(() => host.file()?.name);
			showToast(
				`Can't play "${name}". This browser can't decode its video`,
				"error",
				8000,
			);
		});
		$effect(() => {
			this.player?.setSpeed(this.speed);
		});
		$effect(() => {
			if (this.player) this.player.loop = host.loop();
		});
		$effect(() => {
			this.player?.setSpan(this.spanStart, this.spanEnd);
		});
		$effect(() => {
			this.player?.setMuted(!!host.audio().trackFile);
		});
		$effect(() => {
			if (this.el) this.el.playbackRate = this.speed;
		});
		$effect(() => this.#probeAudio());
	}

	#buildPlayer() {
		const host = this.#host;
		const current = host.file();
		if (!host.isVideo() || !current) return;
		const proxy = host.proxyFor(current);
		const previewFile = proxy ?? current;
		// Same file means only the decoder changed: the proxy landed, or was turned off.
		const swap = this.#playerFile === current;
		const last = swap ? this.#lastPlayer : null;
		// Read untracked: tracking would rebuild the player.
		const media = proxy
			? untrack(() => {
					const natural = host.naturalSize();
					return {
						width: last?.width ?? natural.width ?? 0,
						height: last?.height ?? natural.height ?? 0,
						duration: this.duration,
					};
				})
			: undefined;
		const resume = untrack(() => ({
			time: last?.time ?? 0,
			playing: last?.playing ?? false,
			spanStart: this.spanStart,
			spanEnd: this.spanEnd,
			recordDuration: host.recordDuration(),
		}));
		let cancelled = false;
		let player: VideoPreviewPlayer | null = null;
		if (!swap)
			untrack(() => (this.unplayable = { player: false, element: false }));
		VideoPreviewPlayer.create(previewFile, media).then((p) => {
			if (cancelled || !p) {
				p?.dispose();
				if (!cancelled && !swap) this.unplayable.player = true;
				return;
			}
			player = p;
			this.#playerFile = current;
			this.player = p;
			this.el?.pause();
			if (this.el) this.el.muted = true;
			this.duration = p.duration;
			if (swap) {
				// Same media, other decoder: keep the span and the playhead.
				this.spanStart = resume.spanStart;
				this.spanEnd = resume.spanEnd;
				host.setRecordDuration(resume.recordDuration);
				if (resume.time > 0.05) p.seek(resume.time);
			} else {
				this.spanStart = 0;
				this.spanEnd = p.duration;
				host.setRecordDuration(Math.round(p.duration * 10) / 10);
			}
			// The probe may have built an element-sourced graph first; rebuild it sourceless.
			if (host.audio().audioContext && !host.audio().trackFile) {
				host.audio().disposeAudioGraph();
			}
			this.ensureAudioGraph();
			// Starts paused on purpose, see audioUnlocked, unless a swap cut playback short.
			if (swap && resume.playing) p.play();
		});
		return () => {
			cancelled = true;
			// Still building: the one before it is the latest state there is.
			if (player)
				this.#lastPlayer = {
					time: player.currentTime,
					playing: player.playing,
					width: player.width,
					height: player.height,
				};
			player?.dispose();
			this.player = null;
		};
	}

	/** Probe for an audio track; gates the volume slider and Web Audio capture. */
	#probeAudio() {
		const host = this.#host;
		const probed = host.file();
		if (!host.isVideo() || !probed) return;
		this.hasAudio = false;
		void (async () => {
			try {
				const mb = await import("mediabunny");
				const input = new mb.Input({
					source: new mb.BlobSource(probed),
					formats: mb.ALL_FORMATS,
				});
				try {
					const track = await input.getPrimaryAudioTrack();
					if (host.file() === probed) this.hasAudio = !!track;
				} finally {
					input.dispose();
				}
			} catch {
				if (host.file() === probed) this.hasAudio = true;
			}
		})();
	}

	ensureAudioGraph() {
		const audio = this.#host.audio();
		if (!this.audioUnlocked) return;
		// Skip silent videos: capturing them breaks the speed control in Firefox.
		if (audio.audioContext || audio.trackFile || !this.hasAudio) return;
		if (this.player) {
			// WebCodecs preview: sourceless graph; the player connects its own source node.
			const state = createOutputAudioGraph();
			audio.applyAudioGraphState(state);
			this.player.attachAudioOutput(state.context, state.normalizeGain);
			state.context.resume().catch(() => {});
			return;
		}
		if (!this.el) return;
		this.el.muted = false;
		const state = createAudioGraph(this.el);
		audio.applyAudioGraphState(state);
		audio.audioContext!.resume().catch(() => {});
	}

	play = () => {
		const audio = this.#host.audio();
		// First play is a user gesture, so the graph can be created unblocked.
		this.audioUnlocked = true;
		this.ensureAudioGraph();
		audio.audioContext?.resume();
		// Start from the static marker when the video owns the clock.
		const marker = this.#host.markerTime();
		const fromMarker = marker !== null;
		if (fromMarker && !this.isPlaying) this.seekTo(marker);
		// Past the span end is where the user put the marker, so it plays from there.
		const outOfSpan = (t: number) =>
			t < this.spanStart ||
			(!fromMarker && t >= this.spanEnd - VIDEO_END_EPSILON);
		if (this.player) {
			if (outOfSpan(this.player.currentTime)) this.player.seek(this.spanStart);
			this.player.play();
			return;
		}
		if (!this.el) return;
		if (outOfSpan(this.el.currentTime)) this.el.currentTime = this.spanStart;
		this.pastSpan = this.el.currentTime >= this.spanEnd - VIDEO_END_EPSILON;
		this.el.play().catch(() => {});
	};

	pause = () => {
		if (this.player) {
			this.player.pause();
			return;
		}
		this.el?.pause();
	};

	seekTo = (t: number) => {
		if (!this.duration) return;
		const clamped = Math.max(0, Math.min(this.duration, t));
		this.pastSpan = clamped >= this.spanEnd - VIDEO_END_EPSILON;
		if (this.player) {
			this.player.seek(clamped);
			return;
		}
		if (!this.el) return;
		this.el.currentTime = clamped;
		this.elementTime = clamped;
	};

	// The element's events. The player owns duration, span and audio when it's up; the
	// element is only the recording fallback then.

	onLoadedMetadata = () => {
		if (this.player || !this.el) return;
		// A recorder's WebM reports Infinity until played through: no length, not an endless one.
		const dur = Number.isFinite(this.el.duration) ? this.el.duration : 0;
		this.duration = dur;
		this.spanStart = 0;
		this.spanEnd = dur;
		this.pastSpan = false;
		if (dur > 0) this.#host.setRecordDuration(Math.round(dur * 10) / 10);
		this.ensureAudioGraph();
	};

	onTimeUpdate = () => {
		if (this.player) return;
		this.elementTime = this.el?.currentTime ?? 0;
		// Span-loop: skip during recording (export seeks the video directly)
		if (
			!this.#host.recording() &&
			!this.pastSpan &&
			this.el &&
			this.elementTime >= this.spanEnd
		) {
			this.el.currentTime = this.spanStart;
			if (!this.#host.loop()) this.el.pause();
		}
	};

	onEnded = () => {
		// Natural end can fire before timeupdate reaches spanEnd
		if (
			!this.player &&
			!this.#host.recording() &&
			!this.pastSpan &&
			this.el &&
			this.#host.loop()
		) {
			this.el.currentTime = this.spanStart;
			this.el.play().catch(() => {});
		}
	};
}
