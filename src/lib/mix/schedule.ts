import { segmentEnvelope, trimSegment, type MixSegment } from "./plan";

export interface MixBuses {
	/** What is heard. */
	mix: AudioNode | null;
	/** What the audio links hear: the driving lanes only. */
	drive: AudioNode | null;
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
): AudioBufferSourceNode[] {
	const nodes: AudioBufferSourceNode[] = [];
	const when = (t: number) => ctxAt + (t - from);
	for (const whole of plan) {
		const seg = trimSegment(whole, from, to);
		if (!seg) continue;
		const heard = buses.mix !== null;
		const drives = seg.drives && buses.drive !== null;
		if (!heard && !drives) continue;
		const buffer = bufferOf(seg.sourceId);
		if (!buffer || seg.offset >= buffer.duration) continue;

		const node = ctx.createBufferSource();
		node.buffer = buffer;
		node.playbackRate.value = seg.rate;
		const gain = ctx.createGain();
		const envelope = segmentEnvelope(seg);
		gain.gain.setValueAtTime(envelope[0]?.gain ?? seg.gain, when(seg.start));
		for (const point of envelope.slice(1)) {
			gain.gain.linearRampToValueAtTime(point.gain, when(point.t));
		}
		node.connect(gain);
		if (heard) gain.connect(buses.mix!);
		if (drives) gain.connect(buses.drive!);
		node.start(when(seg.start), seg.offset, (seg.end - seg.start) * seg.rate);
		nodes.push(node);
	}
	return nodes;
}

export function stopNodes(nodes: AudioBufferSourceNode[]): void {
	for (const node of nodes) {
		try {
			node.stop();
		} catch {
			// Never started.
		}
		node.disconnect();
	}
}
