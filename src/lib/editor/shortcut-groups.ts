/** The rows behind the shortcuts modal, in one place so every mode lists the
 * same gesture the same way. Keys in one row are alternatives. Every
 * description is one short line: the modal is a cheat sheet, not the docs.
 *
 * Each row names what the code does, including the case where it does
 * nothing — a sheet that promises more than the keys deliver is worse than
 * none. When a binding changes, this file changes with it. */

export interface ShortcutRow {
	keys: string[];
	description: string;
}

export interface ShortcutGroup {
	title: string;
	shortcuts: ShortcutRow[];
}

const MOSH: ShortcutRow = {
	keys: ["←", "→"],
	description: "Previous or next mosh; → past the newest rolls a fresh one",
};

const UNDO: ShortcutRow[] = [
	{
		keys: ["Ctrl/Cmd+Z"],
		description: "Undo the last edit (moshes don't count)",
	},
	{ keys: ["Ctrl/Cmd+Shift+Z", "Ctrl/Cmd+Y"], description: "Redo" },
];

const SAVE_FRAME: ShortcutRow = {
	keys: ["Ctrl/Cmd+S"],
	description: "Save the frame on screen as an image",
};

const FULLSCREEN: ShortcutRow = {
	keys: ["F"],
	description: "Fullscreen preview; Esc leaves it",
};

/** The shared axis: every lane is the ruler, and the view is one viewport. */
const TIMELINE: ShortcutGroup = {
	title: "Timeline",
	shortcuts: [
		{
			keys: ["Click empty space"],
			description: "Put the start marker there; playback begins from it",
		},
		{ keys: ["Drag empty space"], description: "Scrub" },
		{
			keys: ["Drag a song handle"],
			description: "Trim the playback span; dbl-click a handle resets it",
		},
		{
			keys: ["Scroll"],
			description: "Zoom around the playhead, or the cursor",
		},
		{ keys: ["Shift+Scroll"], description: "Pan" },
		{ keys: ["+", "-"], description: "Zoom one notch" },
		{
			keys: ["C"],
			description:
				"Follow the playhead, or stop; a scroll or scrub stops it too",
		},
	],
};

/** Selection and editing that every clip lane answers to the same way —
 * text, media and FX lanes alike, so it is listed once. */
const CLIPS: ShortcutGroup = {
	title: "Clips",
	shortcuts: [
		{
			keys: ["Click"],
			description:
				"Select a clip and open its panel; click it again to deselect",
		},
		{
			keys: ["Shift+Click"],
			description: "Select every clip between it and the last one picked",
		},
		{
			keys: ["Ctrl/Cmd+Shift+Click"],
			description: "Add or remove one clip from the selection",
		},
		{
			keys: ["Dbl-click", "Ctrl/Cmd+Click"],
			description: "Add a clip in empty lane space",
		},
		{ keys: ["Ctrl/Cmd+Click a clip"], description: "Split it at the cursor" },
		{
			keys: ["S"],
			description:
				"Split the clip under the playhead on the lane you last touched",
		},
		{
			keys: ["Drag"],
			description:
				"Move the selection; media and FX clips can cross to another lane",
		},
		{ keys: ["Drag an edge"], description: "Trim one clip" },
		{ keys: ["Drag a boundary"], description: "Trim both clips it joins" },
		{
			keys: ["Alt+Drag"],
			description: "Hold the snap off (edges, beats, marker)",
		},
		{ keys: ["R"], description: "Loop playback inside the selected clip" },
		{ keys: ["Delete", "Backspace"], description: "Delete the selection" },
		{ keys: ["Esc"], description: "Deselect" },
		{ keys: ["Dbl-click a lane name"], description: "Rename the lane" },
	],
};

/** Copy/paste is per lane kind; the newest copy is the one a paste answers. */
const COPY: ShortcutRow = {
	keys: ["Ctrl/Cmd+C"],
	description: "Copy the selected clips",
};

const FX_LANES: ShortcutGroup = {
	title: "FX lanes",
	shortcuts: [
		COPY,
		{
			keys: ["Ctrl/Cmd+V"],
			description:
				"Paste the copied effects onto the selected clips; with none selected, stamp copies at the start marker on the lane you last touched",
		},
	],
};

const MEDIA_LAYERS: ShortcutGroup = {
	title: "Media layers",
	shortcuts: [
		{
			keys: ["Click a thumb"],
			description: "Show it on the selected clips; with none, preview it",
		},
		{ keys: ["Drag a thumb onto a clip"], description: "Show it on that clip" },
		{ keys: ["Drag a thumb into a gap"], description: "Add a clip showing it" },
		{
			keys: ["Dbl-click a thumb"],
			description: "Preview it full size; ← → step through, Esc closes",
		},
		COPY,
		{
			keys: ["Ctrl/Cmd+V"],
			description:
				"Paste what the copies showed onto the selected clips; with none selected, stamp copies at the start marker on the lane you last touched",
		},
	],
};

export function editorShortcutGroups(opts: {
	sequence: boolean;
	fxLanes: boolean;
	text: boolean;
	media: boolean;
}): ShortcutGroup[] {
	const { sequence, fxLanes, text, media } = opts;
	return [
		{
			title: "Editor",
			shortcuts: [
				{
					keys: ["Space"],
					description: "Play or pause, from the start marker",
				},
				sequence
					? {
							keys: MOSH.keys,
							description:
								"Previous or next mosh of the selected clip; → past the newest rolls a fresh one. Nothing selected, nothing rolls",
						}
					: MOSH,
				...UNDO,
				SAVE_FRAME,
				...(sequence
					? []
					: [
							{
								keys: ["V"],
								description: "Bake the current frame as the new source",
							},
						]),
				FULLSCREEN,
			],
		},
		TIMELINE,
		...(sequence || text || media ? [CLIPS] : []),
		...(sequence && fxLanes ? [FX_LANES] : []),
		...(media ? [MEDIA_LAYERS] : []),
	];
}

export function slideshowShortcutGroups(opts: {
	text: boolean;
}): ShortcutGroup[] {
	return [
		{
			title: "Slideshow",
			shortcuts: [
				{ keys: ["Space"], description: "Play or pause the preview" },
				{ keys: ["Esc"], description: "Stop the preview" },
				MOSH,
				...UNDO,
			],
		},
		TIMELINE,
		{
			title: "Segments",
			shortcuts: [
				{
					keys: ["Ctrl/Cmd+Click"],
					description: "Create or split a segment at the cursor",
				},
				{ keys: ["Click"], description: "Select a segment" },
				{ keys: ["Shift+Drag"], description: "Rectangle-select boundaries" },
				{ keys: ["Ctrl/Cmd+C"], description: "Copy the selected boundaries" },
				{
					keys: ["Ctrl/Cmd+V"],
					description: "Paste by clicking where the first one lands",
				},
				{
					keys: ["Delete", "Backspace"],
					description: "Delete the selection; over a dot, merge its segments",
				},
				{ keys: ["Esc"], description: "Deselect, or cancel a paste" },
			],
		},
		...(opts.text ? [CLIPS] : []),
	];
}
