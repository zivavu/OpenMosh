/** The rows behind the shortcuts modal, in one place so every mode lists a gesture
 * the same way. Keys in a row are alternatives; descriptions stay one short line. */

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
	{ keys: ["Ctrl/Cmd+Z"], description: "Undo" },
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

/** Selection and editing that every clip lane answers the same way (text, media,
 * FX), so it is listed once. */
const CLIP_ROWS: ShortcutRow[] = [
	{
		keys: ["Click"],
		description: "Select a clip and open its panel; click it again to deselect",
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
		keys: ["Shift+Drag"],
		description:
			"Box-select the clips it touches, and on layers the joins inside it",
	},
	{
		keys: ["Click a layer join"],
		description:
			"Set its transition; clicking one of several selected edits them all",
	},
	{
		keys: ["Shift+Click a layer join"],
		description: "Add or remove it from the selected joins",
	},
	{
		keys: ["Drag a selected join"],
		description: "Move every selected join together",
	},
	{
		keys: ["Ctrl/Cmd+C", "Ctrl/Cmd+V"],
		description:
			"With only joins selected, copy their cuts and transitions; paste by clicking where the first lands",
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
	{
		keys: ["Ctrl/Cmd+C"],
		description: "Copy the selected clips",
	},
	{
		keys: ["Ctrl/Cmd+V"],
		description:
			"Paste onto the selected clips — the text, the effects, or what the copies showed; with none selected, stamp copies at the start marker on the lane you last touched",
	},
	{ keys: ["Esc"], description: "Deselect" },
	{ keys: ["Dbl-click a lane name"], description: "Rename the lane" },
];

const CLIPS: ShortcutGroup = { title: "Clips", shortcuts: CLIP_ROWS };

/** Every clip carries its own chain, so in the editor the arrows mosh the selected
 * one: a clip row, not an editor row. */
const CLIP_MOSH: ShortcutRow = {
	keys: MOSH.keys,
	description:
		"Previous or next mosh of the selected clip; → past the newest rolls a fresh one. Nothing selected, nothing rolls",
};

const MEDIA_LAYERS: ShortcutGroup = {
	title: "Media layers",
	shortcuts: [
		{
			keys: ["Click a thumb"],
			description: "Preview it full size; ← → step through, Esc closes",
		},
		{
			keys: ["Enter on a thumb"],
			description: "Show it on the selected clips",
		},
		{ keys: ["Drag a thumb onto a clip"], description: "Show it on that clip" },
		{ keys: ["Drag a thumb into a gap"], description: "Add a clip showing it" },
	],
};

export function editorShortcutGroups(opts: {
	sequence: boolean;
	text: boolean;
	media: boolean;
}): ShortcutGroup[] {
	const { sequence, text, media } = opts;
	return [
		{
			title: "Editor",
			shortcuts: [
				{
					keys: ["Space"],
					description: "Play or pause, from the start marker",
				},
				...(sequence ? [] : [MOSH]),
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
		...(sequence
			? [{ title: "Clips", shortcuts: [CLIP_MOSH, ...CLIP_ROWS] }]
			: text || media
				? [CLIPS]
				: []),
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
