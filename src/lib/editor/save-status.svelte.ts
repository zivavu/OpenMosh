/** What the top bar says about saving: every autosave path reports here by name, and
 * the bar shows the worst of them. */

export type SaveState = "idle" | "saving" | "saved" | "failed";

type ChannelState = "pending" | "saving" | "ok" | "failed";

export class SaveTracker {
	#channels = $state<Record<string, ChannelState>>({});
	/** When a write last landed, for the tooltip. */
	lastSavedAt = $state<number | null>(null);

	/** A debounced save is queued: the edit isn't on disk yet. */
	schedule(channel: string): void {
		this.#channels[channel] = "pending";
	}

	/** The queued save decided there was nothing to write. */
	drop(channel: string): void {
		delete this.#channels[channel];
	}

	/** Follow one write through; `ok` is false when it failed. */
	async track(channel: string, write: Promise<boolean>): Promise<boolean> {
		this.#channels[channel] = "saving";
		let ok = false;
		try {
			ok = await write;
		} catch {
			ok = false;
		}
		// A newer save queued meanwhile owns the channel now.
		if (this.#channels[channel] === "saving") {
			this.#channels[channel] = ok ? "ok" : "failed";
		}
		if (ok) this.lastSavedAt = Date.now();
		return ok;
	}

	get state(): SaveState {
		const states = Object.values(this.#channels);
		if (states.includes("failed")) return "failed";
		if (states.includes("pending") || states.includes("saving")) {
			return "saving";
		}
		return states.includes("ok") ? "saved" : "idle";
	}
}
