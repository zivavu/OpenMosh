/** What the editor's effects panel says when there's no chain to edit: nothing
 * selected, or only sound, which has no effects of its own. */

export interface PanelEmpty {
	title: string;
	hint: string;
	/** The one thing worth offering right there: letting the sound drive the effects. */
	action?: "drive";
}

const CLIP_HINT =
	"Click a media clip or an FX clip on the timeline to edit its chain.";
const AUDIO_BAR =
	"Volume, loop, fades and BPM source are in the bar under the timeline.";

export function panelEmpty(audio: {
	/** Audio clips selected. */
	clips: number;
	/** How many of their lanes drive the effects, out of `lanes`. */
	driving: number;
	lanes: number;
}): PanelEmpty {
	if (audio.clips === 0) return { title: "Nothing selected", hint: CLIP_HINT };
	const many = audio.clips > 1;
	const title = many ? `${audio.clips} audio clips` : "Audio clip";
	const sound = many ? "these sounds" : "this sound";
	if (audio.driving === audio.lanes)
		return {
			title,
			hint: `Audio has no effect chain. Effects react to ${sound} through their audio links. ${AUDIO_BAR}`,
		};
	return {
		title,
		hint: `Audio has no effect chain. Turn on Drives FX to make effects react to ${sound}. ${AUDIO_BAR}`,
		action: "drive",
	};
}
