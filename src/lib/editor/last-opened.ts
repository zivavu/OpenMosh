/** What the app reopens on a reload: the edit that was open, by the key it's saved under. */

import { readJson, writeJson } from "../storage";
import type { SessionMode } from "./sequence-media-store";

export interface LastOpened {
	mode: "sequence" | SessionMode;
	key: string;
}

const KEY = "openmosh-last-opened";

export function readLastOpened(): LastOpened | null {
	const v = readJson<LastOpened | null>(KEY, null);
	return v && typeof v.key === "string" && typeof v.mode === "string"
		? v
		: null;
}

export function rememberLastOpened(entry: LastOpened): void {
	writeJson(KEY, entry);
}

/** A fresh upload isn't saved anywhere yet, so a reload must not land on the last edit. */
export function forgetLastOpened(): void {
	writeJson(KEY, null);
}
