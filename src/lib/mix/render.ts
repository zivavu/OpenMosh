import { trimSegment, type MixSegment } from "./plan";
import { scheduleMix } from "./schedule";

const SAMPLE_RATE = 48000;

async function renderPart(
	plan: MixSegment[],
	bufferOf: (sourceId: string) => AudioBuffer | null,
	from: number,
	to: number,
	part: "mix" | "drive",
	channels = 2,
): Promise<AudioBuffer> {
	const length = Math.max(1, Math.ceil((to - from) * SAMPLE_RATE));
	const ctx = new OfflineAudioContext(channels, length, SAMPLE_RATE);
	scheduleMix(
		ctx,
		plan,
		bufferOf,
		part === "mix"
			? { mix: ctx.destination, drive: null }
			: { mix: null, drive: ctx.destination },
		from,
		to,
		0,
	);
	return ctx.startRendering();
}

/** The export's sound for timeline [from, to): what is heard, and what the effects
 * react to. Either is null when nothing in the span makes a sound there. */
export async function renderMix(
	plan: MixSegment[],
	bufferOf: (sourceId: string) => AudioBuffer | null,
	from: number,
	to: number,
): Promise<{ mix: AudioBuffer | null; drive: AudioBuffer | null }> {
	const audible = plan.filter(
		(s) => bufferOf(s.sourceId) && trimSegment(s, from, to),
	);
	if (audible.length === 0 || to <= from) return { mix: null, drive: null };
	const mix = await renderPart(audible, bufferOf, from, to, "mix");
	const driving = audible.filter((s) => s.drives);
	const drive =
		driving.length > 0
			? await renderPart(driving, bufferOf, from, to, "drive")
			: null;
	return { mix, drive };
}

/** What the effects react to across the whole timeline, mixed to mono (as the analysis
 * hears it anyway), for the song profile. Null when nothing drives them. */
export async function renderDrive(
	plan: MixSegment[],
	bufferOf: (sourceId: string) => AudioBuffer | null,
	duration: number,
): Promise<AudioBuffer | null> {
	const driving = plan.filter(
		(s) => s.drives && bufferOf(s.sourceId) && trimSegment(s, 0, duration),
	);
	if (driving.length === 0 || duration <= 0) return null;
	return renderPart(driving, bufferOf, 0, duration, "drive", 1);
}
