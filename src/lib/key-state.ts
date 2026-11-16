/** How an animated slider reads at the playhead, for its thumb and read-out colour
 * (`data-key-state`, styled in app.css). */
export type KeyState = "recording" | "on-key" | "grouped" | "animated";

export function keyState(o: {
	keyed: boolean;
	/** A key sits at the playhead. */
	here: boolean;
	grouped: boolean;
	recording?: boolean;
}): KeyState | undefined {
	if (!o.keyed) return undefined;
	if (o.recording) return "recording";
	if (o.here) return "on-key";
	return o.grouped ? "grouped" : "animated";
}
