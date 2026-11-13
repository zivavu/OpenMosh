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
