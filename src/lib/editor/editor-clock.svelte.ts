/** The clock the editor's lanes, preview and export run on. The editor's is the mixer.
 * Single mode's is its song when it has one, else its video, else a free-running loop
 * of the export length, so text over a still image still has a playhead. */

import { untrack } from "svelte";
import type { AudioManager } from "../audio/audio-manager.svelte";
import type { SequenceMixer } from "../mix/mixer.svelte";
import type { SingleVideo } from "./single-video.svelte";

/** What the lyrics-sync modal plays and seeks. */
export interface ClockTransport {
	isPlaying: boolean;
	spanStart: number;
	spanEnd: number;
	getCurrentTime: () => number;
	onPlay: () => void;
	onPause: () => void;
	onSeek: (t: number) => void;
}

export interface EditorClock {
	/** Single mode with a song: the song is the clock, as in the export. */
	readonly masterIsAudio: boolean;
	/** Length of the master clock; 0 when nothing has one. */
	readonly duration: number;
	/** Length the lanes run on: the clock's, else the export length. */
	readonly length: number;
	/** Nothing else owns a playhead, so the clock runs its own loop. */
	readonly ownTransport: boolean;
	/** Where the lanes are now. */
	readonly time: number;
	readonly running: boolean;
	/** An export's frame 0 isn't the clock's zero: it starts at the span. */
	readonly exportOffset: number;
	/** Frame time to clock time, for a video played off speed. */
	readonly exportScale: number;
	/** The master source's own time, without the free-running loop. */
	masterTime(): number;
	playing(): boolean;
	toggle(): void;
	seek(t: number): void;
	toggleLoop(): void;
	/** Play the song (or the mix) from the timeline's marker. */
	playSpan(): void;
	pause(): void;
	/** Seek the song (or the mix) alone. */
	seekSong(t: number): void;
	transport(): ClockTransport;
}

export interface SequenceClockHost {
	mixer: SequenceMixer;
	/** The timeline's static marker, once the timeline is up. */
	marker(): number | null;
	/** Media is still loading, so play waits. */
	busy(): boolean;
	exportLength(): number;
}

export class SequenceClock implements EditorClock {
	readonly #host: SequenceClockHost;
	readonly masterIsAudio = false;
	readonly ownTransport = false;
	readonly exportScale = 1;

	constructor(host: SequenceClockHost) {
		this.#host = host;
	}

	get duration() {
		return this.#host.mixer.duration;
	}
	get length() {
		return this.duration > 0 ? this.duration : this.#host.exportLength();
	}
	get time() {
		return this.#host.mixer.currentTime;
	}
	get running() {
		return this.#host.mixer.playing;
	}
	get exportOffset() {
		return this.#host.mixer.spanStart;
	}

	masterTime() {
		return this.#host.mixer.currentTime;
	}
	playing() {
		return this.#host.mixer.playing;
	}

	playSpan = () => {
		const { mixer } = this.#host;
		// Playback starts at the static marker, not wherever the clock last stopped.
		const marker = this.#host.marker();
		if (marker !== null && !mixer.playing) mixer.seek(marker);
		mixer.play();
	};
	pause = () => this.#host.mixer.pause();
	seekSong = (t: number) => this.#host.mixer.seek(t);
	seek = (t: number) => this.#host.mixer.seek(t);
	toggle = () => {
		if (this.#host.mixer.playing) this.pause();
		else if (!this.#host.busy()) this.playSpan();
	};
	toggleLoop = () => {
		this.#host.mixer.loop = !this.#host.mixer.loop;
	};

	transport(): ClockTransport {
		const { mixer } = this.#host;
		return {
			isPlaying: mixer.playing,
			spanStart: mixer.spanStart,
			spanEnd: mixer.spanEnd,
			getCurrentTime: () => mixer.currentTime,
			onPlay: this.playSpan,
			onPause: this.pause,
			onSeek: this.seek,
		};
	}
}

export interface SingleClockHost {
	audio: AudioManager;
	video: SingleVideo;
	isVideo(): boolean;
	marker(): number | null;
	exportLength(): number;
	loop(): boolean;
	setLoop(on: boolean): void;
}

/** Runs an effect, so construct it during component init. */
export class SingleClock implements EditorClock {
	readonly #host: SingleClockHost;

	/** The free-running loop's playhead, when nothing else owns one. */
	stillTime = $state(0);
	stillPlaying = $state(false);
	/** Bumped on every seek, so the running loop re-anchors on the new time. */
	#stillSeekTick = $state(0);

	constructor(host: SingleClockHost) {
		this.#host = host;
		$effect(() => this.#runStill());
	}

	get masterIsAudio() {
		return !!this.#host.audio.trackFile;
	}
	get duration() {
		const { audio, video } = this.#host;
		return this.masterIsAudio ? audio.trackDuration : video.duration;
	}
	get length() {
		return this.duration > 0 ? this.duration : this.#host.exportLength();
	}
	get ownTransport() {
		return this.duration <= 0;
	}
	get time() {
		return this.ownTransport ? this.stillTime : this.masterTime();
	}
	get running() {
		const { audio, video } = this.#host;
		return this.ownTransport
			? this.stillPlaying
			: audio.audioPlaying || video.isPlaying;
	}
	get exportOffset() {
		const { audio, video } = this.#host;
		if (audio.trackFile && audio.trackDuration > 0) return audio.spanStart;
		return this.#host.isVideo() && video.duration > 0 ? video.spanStart : 0;
	}
	get exportScale() {
		const { audio, video } = this.#host;
		return !audio.trackFile && this.#host.isVideo() && video.duration > 0
			? video.speed
			: 1;
	}

	masterTime() {
		const { audio, video } = this.#host;
		return this.masterIsAudio ? audio.trackCurrentTime : video.clock;
	}
	playing() {
		const { audio, video } = this.#host;
		if (this.ownTransport) return this.stillPlaying;
		return this.masterIsAudio ? audio.audioPlaying : video.isPlaying;
	}

	playSpan = () => {
		const { audio, video } = this.#host;
		const marker = this.#host.marker();
		if (marker !== null && !audio.audioPlaying) audio.seekTo(marker);
		audio.playAudio();
		if (this.#host.isVideo()) video.play();
	};
	pause = () => {
		this.#host.audio.pauseAudio();
		if (this.#host.isVideo()) this.#host.video.pause();
	};
	seekSong = (t: number) => this.#host.audio.seekTo(t);

	toggle = () => {
		const { audio, video } = this.#host;
		if (this.ownTransport) {
			this.stillPlaying = !this.stillPlaying;
		} else if (this.masterIsAudio) {
			if (audio.audioPlaying) this.pause();
			else this.playSpan();
		} else if (video.isPlaying) {
			video.pause();
		} else {
			video.play();
		}
	};

	seek = (t: number) => {
		if (this.ownTransport) {
			this.stillTime = t;
			this.#stillSeekTick++;
		} else if (this.masterIsAudio) this.seekSong(t);
		else this.#host.video.seekTo(t);
	};

	toggleLoop = () => {
		const { audio } = this.#host;
		if (this.masterIsAudio) audio.loopAudio = !audio.loopAudio;
		else this.#host.setLoop(!this.#host.loop());
	};

	transport(): ClockTransport {
		const { audio, video } = this.#host;
		if (this.ownTransport) {
			return {
				isPlaying: this.stillPlaying,
				spanStart: 0,
				spanEnd: this.length,
				getCurrentTime: () => this.stillTime,
				onPlay: () => (this.stillPlaying = true),
				onPause: () => (this.stillPlaying = false),
				onSeek: (t) => (this.stillTime = t),
			};
		}
		const onAudio = this.masterIsAudio;
		return {
			isPlaying: audio.audioPlaying || video.isPlaying,
			spanStart: onAudio ? audio.spanStart : video.spanStart,
			spanEnd: onAudio ? audio.spanEnd : video.spanEnd,
			getCurrentTime: () => (onAudio ? audio.trackCurrentTime : video.clock),
			onPlay: onAudio ? this.playSpan : video.play,
			onPause: onAudio ? this.pause : video.pause,
			onSeek: onAudio ? this.seekSong : video.seekTo,
		};
	}

	#runStill() {
		if (!this.stillPlaying) return;
		// Tracked, so a seek mid-run restarts the loop on the new position.
		this.#stillSeekTick;
		const span = Math.max(0.1, this.length);
		const started = performance.now() - untrack(() => this.stillTime) * 1000;
		const loop = (now: number) => {
			this.stillTime = ((now - started) / 1000) % span;
			raf = requestAnimationFrame(loop);
		};
		let raf = requestAnimationFrame(loop);
		return () => cancelAnimationFrame(raf);
	}
}
