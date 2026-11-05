/** The song on screen as Arcs reads it. One at a time, like the song profile: the
 * renderer has no line to the mixer, and preview and export both read this. */

import { buildControls, type Controls, type SongAudio } from "./controls";
import { allForms, type Look } from "./look";

/** Tables kept per song: one for each seed and form setting in use. */
const MAX_TABLES = 16;

let active: SongAudio | null = null;
let pending: Promise<unknown> | null = null;
let token = 0;
const tables = new WeakMap<SongAudio, Map<string, Controls>>();

export function activeArcsSong(): SongAudio | null {
	return active;
}

/** A later call supersedes one still loading; null clears the song. `onReady` fires
 * once the new song is in, so a paused preview can redraw. */
export function publishArcsSong(
	load: (() => Promise<SongAudio | null>) | null,
	onReady?: () => void,
): void {
	const mine = ++token;
	if (!load) {
		active = null;
		pending = null;
		return;
	}
	const start = () =>
		load().then(
			(song) => {
				if (mine !== token) return;
				active = song;
				onReady?.();
			},
			() => {
				if (mine === token) active = null;
			},
		);
	const run = pending
		? pending.then(() => (mine === token ? start() : undefined))
		: start();
	pending = run;
	void run.finally(() => {
		if (pending === run) pending = null;
	});
}

/** Resolves once the song being read is in, so an export matches the preview. */
export async function arcsSongReady(): Promise<void> {
	while (pending) await pending;
}

/** The look's table for this song, built once. */
export function controlsFor(
	song: SongAudio,
	look: Look,
	forms?: number[],
): Controls {
	let held = tables.get(song);
	if (!held) tables.set(song, (held = new Map()));
	const key = `${look.seed}|${look.morphEvery}|${forms?.join() ?? ""}`;
	let controls = held.get(key);
	if (!controls) {
		controls = buildControls(
			song,
			look.seed,
			look.morphEvery,
			forms ?? allForms(),
		);
		if (held.size >= MAX_TABLES) held.clear();
		held.set(key, controls);
	}
	return controls;
}
