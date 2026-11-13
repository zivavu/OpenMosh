import { asOneEdit } from "../editor/edit-clock";

/** The key a panel's previous/next arrow just stepped to, so the timeline selects it. */
export interface KeyFocus {
	/** "chain" for the selected clip's effects, or a media lane's id. */
	owner: string;
	/** The key row it sits on (see key-rows.ts). */
	row: string;
	/** In the row's own seconds: from the clip's start, or the timeline's for a lane. */
	t: number;
	/** New on every step, so stepping back to the same key selects it again. */
	serial: number;
}

export const CHAIN_OWNER = "chain";

let serial = 0;

export const keyFocus = $state<{ current: KeyFocus | null }>({ current: null });

export function focusKey(owner: string, row: string, t: number) {
	keyFocus.current = { owner, row, t, serial: ++serial };
}

/** A shift-drag box over one lane, in timeline seconds: the keys inside it get
 * selected, and the next Delete takes them before it reaches the clips. */
export interface KeyBox {
	laneId: string;
	from: number;
	to: number;
	serial: number;
}

export const keyBox = $state<{ current: KeyBox | null }>({ current: null });

/** What each view picked from the box, as the way to delete it. */
const boxed = new Map<symbol, () => void>();
let tookEvent: Event | null = null;

function disarm() {
	boxed.clear();
	keyBox.current = null;
	removeEventListener("pointerdown", disarm, true);
}

export function boxKeys(laneId: string, from: number, to: number) {
	disarm();
	keyBox.current = { laneId, from, to, serial: ++serial };
	// Any click after the box hands Delete back to whatever it lands on.
	addEventListener("pointerdown", disarm, true);
}

export function holdBoxed(id: symbol, remove: () => void) {
	if (keyBox.current) boxed.set(id, remove);
}

export function dropBoxed(id: symbol) {
	boxed.delete(id);
}

/** Delete the boxed keys, if any are still waiting. True when `e` was spent on them,
 * so every lane kind's handler of the same press leaves the clips alone. */
export function deleteBoxedKeys(e: Event): boolean {
	if (tookEvent === e) return true;
	if (boxed.size === 0) return false;
	const removes = [...boxed.values()];
	disarm();
	tookEvent = e;
	asOneEdit(() => removes.forEach((remove) => remove()));
	return true;
}

export function clearKeyBox() {
	disarm();
}
