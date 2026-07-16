/**
 * Time-stretch an AudioBuffer by `rate` (2 = twice as fast, half duration)
 * while preserving pitch, using WSOLA (waveform-similarity overlap-add).
 * Offline-only — used to match export audio to a sped-up/slowed video.
 */
export function stretchAudioBuffer(
  buffer: AudioBuffer,
  rate: number,
): AudioBuffer {
  if (rate === 1 || buffer.length === 0) return buffer;

  const { sampleRate, numberOfChannels } = buffer;
  const frame = Math.round(sampleRate * 0.04); // 40ms analysis window
  const overlap = frame >> 1; // 50% crossfade
  const hop = frame - overlap;
  const search = Math.round(sampleRate * 0.01); // ±10ms similarity search
  const outLength = Math.max(1, Math.round(buffer.length / rate));

  const out = new AudioBuffer({
    numberOfChannels,
    length: outLength,
    sampleRate,
  });
  const channels: Float32Array[] = [];
  const outChannels: Float32Array[] = [];
  for (let ch = 0; ch < numberOfChannels; ch++) {
    channels.push(buffer.getChannelData(ch));
    outChannels.push(out.getChannelData(ch));
  }

  // Too short for overlap-add: nearest-sample resample (pitch shifts, but
  // clips this short make it inaudible).
  if (buffer.length < frame * 2 + search || outLength <= frame) {
    for (let ch = 0; ch < numberOfChannels; ch++) {
      for (let i = 0; i < outLength; i++) {
        outChannels[ch][i] =
          channels[ch][Math.min(Math.round(i * rate), buffer.length - 1)];
      }
    }
    return out;
  }

  // Mono guide for the similarity search so all channels stay phase-aligned.
  let guide = channels[0];
  if (numberOfChannels > 1) {
    guide = new Float32Array(buffer.length);
    for (let ch = 0; ch < numberOfChannels; ch++) {
      const src = channels[ch];
      for (let i = 0; i < buffer.length; i++) guide[i] += src[i];
    }
  }

  // First frame is copied verbatim; subsequent frames are picked near the
  // ideal (time-scaled) position, biased toward waveform similarity with the
  // natural continuation of the previous frame, then crossfaded in.
  for (let ch = 0; ch < numberOfChannels; ch++) {
    outChannels[ch].set(channels[ch].subarray(0, Math.min(frame, outLength)));
  }

  const maxStart = buffer.length - frame;
  let srcPos = 0;
  for (let outPos = hop; outPos < outLength; outPos += hop) {
    const ideal = Math.min(Math.round(outPos * rate), maxStart);
    const natural = srcPos + hop;
    let best = ideal;
    if (natural + overlap <= buffer.length) {
      const lo = Math.max(0, ideal - search);
      const hi = Math.min(maxStart, ideal + search);
      let bestScore = -Infinity;
      for (let cand = lo; cand <= hi; cand++) {
        let score = 0;
        // Decimated cross-correlation: plenty for a similarity ranking.
        for (let j = 0; j < overlap; j += 4) {
          score += guide[natural + j] * guide[cand + j];
        }
        if (score > bestScore) {
          bestScore = score;
          best = cand;
        }
      }
    }
    for (let ch = 0; ch < numberOfChannels; ch++) {
      const src = channels[ch];
      const dst = outChannels[ch];
      const n = Math.min(frame, outLength - outPos);
      for (let j = 0; j < n; j++) {
        const v = src[best + j];
        dst[outPos + j] =
          j < overlap
            ? dst[outPos + j] * (1 - j / overlap) + v * (j / overlap)
            : v;
      }
    }
    srcPos = best;
  }

  return out;
}
