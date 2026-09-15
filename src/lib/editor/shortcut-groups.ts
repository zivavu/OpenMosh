/** The rows behind the shortcuts modal, in one place so every mode lists the
 * same gesture the same way. Keys in one row are alternatives. */

export interface ShortcutRow {
	keys: string[];
	description: string;
}

export interface ShortcutGroup {
	title: string;
	shortcuts: ShortcutRow[];
}

const UNDO: ShortcutRow[] = [
	{ keys: ["Ctrl/Cmd+Z"], description: "Undo" },
	{ keys: ["Ctrl/Cmd+Shift+Z", "Ctrl/Cmd+Y"], description: "Redo" },
];

const VIEW: ShortcutRow[] = [
	{ keys: ["C"], description: "Follow the playhead" },
	{ keys: ["+", "-"], description: "Zoom the timeline" },
	{ keys: ["Scroll", "Shift+Scroll"], description: "Zoom or pan the timeline" },
];

/** Selection and editing that every clip lane answers to the same way. */
const LANE: ShortcutRow[] = [
	{ keys: ["Click"], description: "Select a clip" },
	{ keys: ["Shift+Click"], description: "Select a range of clips" },
	{
		keys: ["Ctrl/Cmd+Shift+Click"],
		description: "Add or remove one clip from the selection",
	},
	{ keys: ["Drag"], description: "Move the selection" },
	{ keys: ["Drag an edge"], description: "Trim one clip" },
	{ keys: ["Drag a boundary"], description: "Trim both clips it joins" },
	{
		keys: ["Alt+Drag"],
		description: "Move without snapping to edges or beats",
	},
	{ keys: ["Delete", "Backspace"], description: "Delete the selection" },
	{ keys: ["Esc"], description: "Deselect" },
];

const ADD_AND_SPLIT: ShortcutRow[] = [
	{
		keys: ["Dbl-click", "Ctrl/Cmd+Click"],
		description: "Add a clip in empty space",
	},
	{ keys: ["Ctrl/Cmd+Click a clip"], description: "Split it at the cursor" },
];

const TEXT_LANES: ShortcutRow[] = ADD_AND_SPLIT;

const MEDIA_LAYERS: ShortcutRow[] = [
	...ADD_AND_SPLIT,
	{ keys: ["Dbl-click a clip"], description: "Edit the layer's placement" },
	{ keys: ["Solo"], description: "Show one layer by itself (preview only)" },
	{
		keys: ["Drop a thumbnail"],
		description:
			"On a clip, play that media there; on empty space, make it the lane's media",
	},
	{
		keys: ["Ctrl/Cmd+C", "Ctrl/Cmd+V"],
		description:
			"Copy the selection; paste onto selected clips, or with nothing selected stamp copies at the start marker",
	},
];

const FX_LANES: ShortcutRow[] = [
	...ADD_AND_SPLIT,
	{
		keys: ["Ctrl/Cmd+C", "Ctrl/Cmd+V"],
		description:
			"Copy the selection; paste effects onto selected clips (from a segment too), or with nothing selected stamp copies at the start marker",
	},
];

const SEGMENTS: ShortcutRow[] = [
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
	{
		keys: ["Ctrl/Cmd+C", "Ctrl/Cmd+V"],
		description:
			"Copy the selection; paste effects onto a selection, or click where a copied span should land",
	},
	{ keys: ["Esc"], description: "Cancel a paste" },
];

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
				{
					keys: ["←", "→"],
					description: sequence
						? "Previous or next mosh of the selected segment or clip; → past the newest rolls a fresh one"
						: "Previous or next mosh; → past the newest rolls a fresh one",
				},
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
				...VIEW,
			],
		},
		...(sequence || text || media
			? [{ title: "Timeline", shortcuts: LANE }]
			: []),
		...(sequence ? [{ title: "Segments", shortcuts: SEGMENTS }] : []),
		...(sequence && fxLanes
			? [{ title: "FX lanes", shortcuts: FX_LANES }]
			: []),
		...(text ? [{ title: "Text lanes", shortcuts: TEXT_LANES }] : []),
		...(media ? [{ title: "Media layers", shortcuts: MEDIA_LAYERS }] : []),
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
				{
					keys: ["←", "→"],
					description:
						"Previous or next mosh; → past the newest rolls a fresh one",
				},
				...UNDO,
				...VIEW,
			],
		},
		{
			title: "Segments",
			shortcuts: [
				{
					keys: ["Ctrl/Cmd+Click"],
					description: "Create or split a segment at the cursor",
				},
				{ keys: ["Click"], description: "Select a segment" },
				{ keys: ["Shift+Drag"], description: "Rectangle-select boundaries" },
				{
					keys: ["Ctrl/Cmd+C", "Ctrl/Cmd+V"],
					description:
						"Copy the selected boundaries; paste by clicking where the first one lands",
				},
				{
					keys: ["Delete", "Backspace"],
					description:
						"Delete the selected boundaries or segment; over a dot, merge the segments it joins",
				},
				{ keys: ["Esc"], description: "Deselect, or cancel a paste" },
			],
		},
		...(opts.text
			? [{ title: "Text lanes", shortcuts: [...TEXT_LANES, ...LANE] }]
			: []),
	];
}
