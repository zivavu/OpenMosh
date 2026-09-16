/** The rows behind the shortcuts modal, in one place so every mode lists the
 * same gesture the same way. Keys in one row are alternatives. Every
 * description is one short line: the modal is a cheat sheet, not the docs. */

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

const VIEW: ShortcutGroup = {
	title: "View",
	shortcuts: [
		{ keys: ["C"], description: "Follow the playhead" },
		{ keys: ["+", "-"], description: "Zoom the timeline" },
		{ keys: ["Scroll"], description: "Zoom the timeline at the cursor" },
		{ keys: ["Shift+Scroll"], description: "Pan the timeline" },
	],
};

/** Selection and editing that every clip lane answers to the same way —
 * text, media and FX lanes alike, so it is listed once. */
const CLIPS: ShortcutGroup = {
	title: "Clips",
	shortcuts: [
		{ keys: ["Click"], description: "Select a clip" },
		{ keys: ["Shift+Click"], description: "Select a range of clips" },
		{
			keys: ["Ctrl/Cmd+Shift+Click"],
			description: "Add or remove one clip from the selection",
		},
		{
			keys: ["Dbl-click", "Ctrl/Cmd+Click"],
			description: "Add a clip in empty space",
		},
		{ keys: ["Ctrl/Cmd+Click a clip"], description: "Split it at the cursor" },
		{ keys: ["Drag"], description: "Move the selection" },
		{ keys: ["Drag an edge"], description: "Trim one clip" },
		{ keys: ["Drag a boundary"], description: "Trim both clips it joins" },
		{ keys: ["Alt+Drag"], description: "Move without snapping" },
		{ keys: ["Delete", "Backspace"], description: "Delete the selection" },
		{ keys: ["Esc"], description: "Deselect" },
	],
};

const COPY: ShortcutRow = {
	keys: ["Ctrl/Cmd+C"],
	description: "Copy the selection",
};

const FX_LANES: ShortcutGroup = {
	title: "FX lanes",
	shortcuts: [
		COPY,
		{
			keys: ["Ctrl/Cmd+V"],
			description: "Paste effects onto the selection, or stamp at the marker",
		},
	],
};

const MEDIA_LAYERS: ShortcutGroup = {
	title: "Media layers",
	shortcuts: [
		{ keys: ["Dbl-click a clip"], description: "Edit the layer's placement" },
		{ keys: ["Solo"], description: "Preview one layer by itself" },
		{ keys: ["Drop on a clip"], description: "Play that media there" },
		{ keys: ["Drop on a lane"], description: "Make it the lane's media" },
		COPY,
		{
			keys: ["Ctrl/Cmd+V"],
			description: "Paste onto the selection, or stamp at the marker",
		},
	],
};

const SEGMENTS: ShortcutGroup = {
	title: "Segments",
	shortcuts: [
		{
			keys: ["Ctrl/Cmd+Click"],
			description: "Create or split a segment at the cursor",
		},
		{
			keys: ["S"],
			description: "Split the lane you last touched at the playhead",
		},
		{
			keys: ["Alt+Click"],
			description: "Add or remove one segment from the selection",
		},
		{
			keys: ["Shift+Drag"],
			description: "Rectangle-select segments and boundaries",
		},
		{ keys: ["R"], description: "Loop playback inside the selected segment" },
		{
			keys: ["Delete", "Backspace"],
			description: "Over a boundary: merge the segments it joins",
		},
		COPY,
		{
			keys: ["Ctrl/Cmd+V"],
			description:
				"Paste effects onto the selection, or click where the span lands",
		},
		{ keys: ["Esc"], description: "Cancel a paste" },
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
				{ keys: ["Space"], description: "Play or pause" },
				sequence
					? {
							keys: MOSH.keys,
							description:
								"Previous or next mosh of the selected segment or clip",
						}
					: MOSH,
				...UNDO,
				{
					keys: ["Ctrl/Cmd+S"],
					description: "Save the current frame as an image",
				},
				...(sequence
					? []
					: [
							{
								keys: ["V"],
								description: "Bake the current frame as the new source",
							},
						]),
				{ keys: ["F"], description: "Fullscreen preview; Esc leaves it" },
			],
		},
		VIEW,
		...(sequence || text || media ? [CLIPS] : []),
		...(sequence ? [SEGMENTS] : []),
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
		VIEW,
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
