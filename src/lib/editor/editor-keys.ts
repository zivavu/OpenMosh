/** The keys an editor saves under. The editor's project has its own id; a single edit
 * has its session's, and keeps its timeline under that, or under its song or video for
 * edits from before sessions had ids of their own. Store keys carry a mode prefix, so
 * the two modes never share an entry. */

export interface EditorKeys {
	readonly mode: "sequence" | "single";
	readonly prefix: "seq:" | "single:";
	/** What the library and project files know this edit by. */
	readonly ownKey: string;
	/** What the library marks as open. */
	readonly openKey: string | null;
	/** The timeline's key, before the prefix. */
	readonly baseKey: string | null;
	readonly storeKey: string | null;
}

export class ProjectKeys implements EditorKeys {
	readonly mode = "sequence";
	readonly prefix = "seq:";

	constructor(readonly ownKey: string) {}

	get baseKey() {
		return this.ownKey;
	}
	get storeKey() {
		return this.prefix + this.ownKey;
	}
	get openKey() {
		return this.storeKey;
	}
}

export interface SessionKeysHost {
	sessionKey: string;
	/** Set for an edit keyed by its own id. */
	projectBase: string | null;
	masterIsAudio(): boolean;
	trackId(): string | null;
	/** The opened video's own key, for an edit whose clock is the video. */
	videoKey(): string | null;
}

export class SessionKeys implements EditorKeys {
	readonly mode = "single";
	readonly prefix = "single:";
	readonly #host: SessionKeysHost;

	constructor(host: SessionKeysHost) {
		this.#host = host;
	}

	get ownKey() {
		return this.#host.sessionKey;
	}
	get openKey() {
		return this.#host.sessionKey;
	}
	get baseKey() {
		const host = this.#host;
		if (host.projectBase) return host.projectBase;
		if (host.masterIsAudio()) return host.trackId();
		return host.videoKey() ?? host.trackId();
	}
	get storeKey() {
		const base = this.baseKey;
		return base && this.prefix + base;
	}
}
