/** The editor project's song: the track the BPM is measured from and the library shows
 * as loaded. Songs and other sound go onto audio lanes; the first becomes the song. */

import type { AudioManager } from "../audio/audio-manager.svelte";
import { addTrack, getTrack, trackToFile } from "../audio/track-library";
import { showToast } from "../components/ui/toast.svelte";
import type { MediaClip, MediaLane, MediaTimeline } from "../media";
import type { SourceAudioBank } from "../mix/source-audio.svelte";
import { retargetAudioSource, trackIdOf, trackSourceId } from "../mix/types";
import type { ChainTimelineState } from "./chain-timeline-state.svelte";
import type { ProjectTempo } from "./project-tempo.svelte";
import type { SongHandler } from "./song-handler";

export interface ProjectSongsHost {
	audio: AudioManager;
	tempo: ProjectTempo;
	bank: SourceAudioBank;
	media(): ChainTimelineState<MediaTimeline, MediaLane, MediaClip>;
	trackId(): string | null;
	setTrackId(id: string | null): void;
	/** Where sound added from a file lands, unless it becomes the song. */
	playhead(): number;
	placeAudio(
		sourceId: string,
		length: number,
		at: number,
		drives: boolean,
	): void;
	removeAudioClipsOf(sourceId: string): void;
}

export class ProjectSongs implements SongHandler {
	readonly #host: ProjectSongsHost;
	/** Bumped per song pick, so a slower read can't land over a newer pick. */
	#pick = 0;

	constructor(host: ProjectSongsHost) {
		this.#host = host;
	}

	get #songSourceId(): string | null {
		const id = this.#host.trackId();
		return id ? trackSourceId(id) : null;
	}

	#set(file: File, trackId: string) {
		this.#host.audio.trackFile = file;
		this.#host.setTrackId(trackId);
	}

	#drop() {
		const { audio, tempo } = this.#host;
		audio.clearTrack();
		this.#host.setTrackId(null);
		if (!tempo.poolSource) tempo.forget();
	}

	/** Load a library track as the song, or drop the song for null. */
	load = async (trackId: string | null) => {
		const pick = ++this.#pick;
		if (!trackId) {
			this.#drop();
			return;
		}
		const track = await getTrack(trackId).catch(() => null);
		if (!track || pick !== this.#pick) return;
		this.#set(trackToFile(track), trackId);
	};

	/** Sound files onto lanes. The first becomes the song when there's none. */
	addFiles(files: File[]) {
		void this.#addFiles(files);
	}

	async #addFiles(files: File[]) {
		const host = this.#host;
		const at = host.playhead();
		for (const f of files) {
			let track;
			try {
				track = await addTrack(f);
			} catch (e) {
				console.error("Failed to store track:", e);
				showToast(`Couldn't store "${f.name}"`, "error");
				continue;
			}
			const sourceId = trackSourceId(track.id);
			const isSong = !host.audio.trackFile;
			if (isSong) this.#set(f, track.id);
			const buffer = await host.bank.load(sourceId);
			if (!buffer) {
				showToast(`"${f.name}" has no sound that could be decoded`, "error");
				if (isSong) this.#drop();
				continue;
			}
			host.placeAudio(sourceId, buffer.duration, isSong ? 0 : at, isSong);
		}
	}

	/** The library picked a song: it takes the old one's clips, or a lane of its own. */
	pick(file: File, trackId: string) {
		const host = this.#host;
		if (trackId === host.trackId()) return;
		const from = this.#songSourceId;
		const to = trackSourceId(trackId);
		host.tempo.forget();
		host.tempo.poolSource = null;
		this.#set(file, trackId);
		const media = host.media();
		const lanes = media.timeline.audioLanes ?? [];
		if (from && lanes.some((l) => l.clips.some((c) => c.sourceId === from))) {
			media.pushHistory();
			media.set({
				...media.timeline,
				audioLanes: retargetAudioSource(lanes, from, to),
			});
			return;
		}
		void host.bank.load(to).then((buffer) => {
			if (buffer && host.trackId() === trackId) {
				host.placeAudio(to, buffer.duration, 0, true);
			}
		});
	}

	/** Unloading the song takes its clips off the lanes too. */
	clear() {
		const from = this.#songSourceId;
		if (from) this.#host.removeAudioClipsOf(from);
		this.#drop();
	}

	/** The project, not its song, owns what's saved. */
	adopted() {}

	/** A track already on the lanes becomes the song, the one the BPM is measured from;
	 * a video's sound is measured without becoming the song. Unlike `pick`, every clip
	 * stays where it is. */
	setBpmSource = async (sourceId: string) => {
		const { tempo } = this.#host;
		const trackId = trackIdOf(sourceId);
		if (!trackId) {
			if (sourceId === tempo.poolSource) return;
			tempo.poolSource = sourceId;
			tempo.forget();
			return;
		}
		if (trackId === this.#host.trackId()) {
			if (!tempo.poolSource) return;
			tempo.poolSource = null;
			tempo.forget();
			return;
		}
		tempo.poolSource = null;
		const track = await getTrack(trackId).catch(() => null);
		if (!track) {
			showToast("That track is no longer in the library", "error");
			return;
		}
		// Forgotten, so the new song is measured rather than keeping the old one's tempo.
		tempo.forget();
		this.#set(trackToFile(track), trackId);
	};

	/** A library track deleted while clips here still play it. */
	dropDeleted = (trackId: string) => {
		this.#host.removeAudioClipsOf(trackSourceId(trackId));
	};
}
