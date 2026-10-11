import { segmentEnvelope, trimSegment, type MixSegment } from "./plan";

export interface MixBuses {
	/** What is heard. */
	mix: AudioNode | null;
	/** What the audio links hear: the driving lanes only. */
	drive: AudioNode | null;
}

/** One scheduled segment. `trim` carries its volume apart from the fade, so a
 * volume change can reach sound that's already playing. */
export interface ScheduledNode {
	node: AudioBufferSourceNode;
	trim: GainNode;
	/** Index into the plan it came from. */
	index: number;
}

/**
 * Put the plan's sound between timeline `from` and `to` onto `ctx`, with timeline
 * `from` landing at context time `ctxAt`. Returns the nodes, so they can be stopped.
 */
export function scheduleMix(
	ctx: BaseAudioContext,
	plan: MixSegment[],
	bufferOf: (sourceId: string) => AudioBuffer | null,
	buses: MixBuses,
	from: number,
	to: number,
	ctxAt: number,
): ScheduledNode[] {
	const nodes: ScheduledNode[] = [];
	const when = (t: number) => ctxAt + (t - from);
	for (const [index, whole] of plan.entries()) {
		const seg = trimSegment(whole, from, to);
		if (!seg) continue;
		const heard = buses.mix !== null;
		const drives = seg.drives && buses.drive !== null;
		if (!heard && !drives) continue;
		const forward = bufferOf(seg.sourceId);
		if (!forward || seg.offset >= forward.duration) continue;
		const buffer = seg.reversed ? reversedBuffer(forward) : forward;
		// Read from the reversed copy's end, where the forward offset lands.
		const offset = seg.reversed ? forward.duration - seg.offset : seg.offset;

		const node = ctx.createBufferSource();
		node.buffer = buffer;
		node.playbackRate.value = seg.rate;
		const fade = ctx.createGain();
		const envelope = segmentEnvelope({ ...seg, gain: 1 });
		fade.gain.setValueAtTime(envelope[0]?.gain ?? 1, when(seg.start));
		for (const point of envelope.slice(1)) {
			fade.gain.linearRampToValueAtTime(point.gain, when(point.t));
		}
		const trim = ctx.createGain();
		trim.gain.value = seg.gain;
		node.connect(fade);
		fade.connect(trim);
		if (heard) trim.connect(buses.mix!);
		if (drives) trim.connect(buses.drive!);
		node.start(when(seg.start), offset, (seg.end - seg.start) * seg.rate);
		nodes.push({ node, trim, index });
	}
	return nodes;
}

/** Each source's sound back to front, made once: a bouncing clip's return pass. */
const reversed = new WeakMap<AudioBuffer, AudioBuffer>();

function reversedBuffer(buffer: AudioBuffer): AudioBuffer {
	const held = reversed.get(buffer);
	if (held) return held;
	const out = new AudioBuffer({
		numberOfChannels: buffer.numberOfChannels,
		length: buffer.length,
		sampleRate: buffer.sampleRate,
	});
	for (let ch = 0; ch < buffer.numberOfChannels; ch++) {
		out.copyToChannel(buffer.getChannelData(ch).slice().reverse(), ch);
	}
	reversed.set(buffer, out);
	return out;
}

export function stopNodes(nodes: ScheduledNode[]): void {
	for (const { node } of nodes) {
		try {
			node.stop();
		} catch {
			// Never started.
		}
		node.disconnect();
	}
}
