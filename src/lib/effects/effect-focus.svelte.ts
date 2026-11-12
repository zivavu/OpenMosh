/** An effect to open and scroll to in whichever effects panel lists it, asked for
 * from outside the panel (a keyframe row's name). The panel clears it once done. */
export const effectFocus = $state<{ id: string | null }>({ id: null });
