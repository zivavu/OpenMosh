/** The effects INDEX HTML picked from OpenMosh, in the order they're listed there,
 * each with the line its pack README and preview page show. */
export const INDEX_FX: Record<string, string> = {
	mirror: "Folds one half of the frame over the other.",
	kaleido: "Repeats a wedge of the frame around the centre.",
	"channel-split":
		"Pulls red, green and blue apart, in a line, from the centre or as a prism.",
	duotone: "Maps shadows and highlights to two colours of your choice.",
	scanlines: "Rolling CRT lines across the picture.",
	bulge: "Pushes the frame out from a point, or pinches it in.",
	jitter: "Patches of the frame twitch out of place, each on its own clock.",
	wobble: "A slow noise warp that makes the frame swim.",
	slices: "Cuts the frame into strips and slides every other one.",
	tile: "Repeats the frame as a grid of copies that can drift along the rows.",
	"soft-glitch": "Quiet stretches, then fits of torn bands and colour shifts.",
	"data-bend": "Runs of blocks shift and smear like broken bytes in a file.",
	"optical-flow":
		"Smears colour along the picture's own contours, like brush strokes.",
	vhs: "Tape noise, colour bleed and a tracking band rolling down the frame.",
	grain: "Film grain, in mono or colour, mixed in three ways.",
	"screen-jump": "The frame rolls like a TV losing its vertical hold.",
	"resize-glitch":
		"The frame snaps to a new scale around a point on random ticks.",
	"stylize-glitch": "Random rectangles get inverted, dithered or hue shifted.",
	melt: "Drips run down the frame and pile up, the bright parts first.",
	thermal: "A heat-camera palette: thermal, infrared or night vision.",
	"pixel-sort":
		"Streaks pixels along rows or columns between two brightness limits.",
	smear: "Pushes each pixel along a direction set by its own colour.",
	"fiber-displace": "Combs the frame into threads that pull it sideways.",
	relief: "Reads brightness as height and lights it like embossed metal.",
	tunnel:
		"Feeds the last frame back in, zoomed and turned, into an endless tunnel.",
	feedback: "Layers each frame over the last, scaled, turned and hue shifted.",
	swirl: "Twists the frame around its centre.",
	ripple: "Waves run through the frame like a disturbed pond.",
	blur: "A smooth Gaussian blur.",
	"radial-blur": "Streaks the frame out from the centre.",
	"liquid-light": "Refracts the frame through slow, merging blobs of liquid.",
	"flow-contours":
		"Bands the picture by brightness and slides the bands against each other.",
	"rgb-burst": "Noise bursts throw each colour channel a different way.",
	"rgb-strobe": "Each colour channel flips to its negative on its own beat.",
	"circle-warp": "Bends the frame's height into a ring.",
	"pixel-shifter":
		"Rows and columns slide by a wave running along the other axis.",
	"ring-warp": "Concentric rings fold the picture in and out.",
	shockwave: "A ring of distortion travels out from a point.",
};

/** Picked, but not exported yet: each needs something the INDEX FX host doesn't give. */
export const INDEX_FX_HELD: Record<string, string> = {
	datamosh:
		"Keeps four private state buffers (frame pair, motion vectors, cut detector) and reads its own input in its last pass. INDEX FX v2 gives one history, the FX's own last output, and passes can't see the FX input after the first.",
	"motion-mask":
		"Keeps a private background estimate apart from its output and reads its own input in its last pass, which INDEX FX v2 doesn't provide.",
	tracking:
		"Draws on a 2D canvas on the CPU (boxes, labels, links), not in a shader.",
};

/** Credits for effects OpenMosh ported from elsewhere, carried into each file. */
export const UPSTREAM: Record<
	string,
	{ project: string; url: string; notice: string }
> = {};

const XPL = {
	project: "X-PostProcessing-Library",
	url: "https://github.com/QianMo/X-PostProcessing-Library",
	notice: "Copyright (c) 2020 浅墨",
};
const ISF = {
	project: "Vidvox ISF-Files",
	url: "https://github.com/Vidvox/ISF-Files",
	notice: "Copyright (c) 2018",
};
for (const id of ["rgb-burst", "screen-jump"]) UPSTREAM[id] = XPL;
for (const id of [
	"rgb-strobe",
	"circle-warp",
	"pixel-shifter",
	"ring-warp",
	"shockwave",
	"resize-glitch",
	"stylize-glitch",
])
	UPSTREAM[id] = ISF;
