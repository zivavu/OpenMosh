/** What the editor does with songs, whichever mode it's in. */
export interface SongHandler {
	/** Sound files picked or dropped. */
	addFiles(files: File[]): void;
	/** A library song picked to play. */
	pick(file: File, trackId: string, autoplay: boolean): void;
	/** Unload the song. */
	clear(): void;
	/** The song learned its library id without being asked to load it. */
	adopted(trackId: string): void;
}
