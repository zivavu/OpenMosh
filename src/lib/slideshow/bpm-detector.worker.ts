import { Essentia, EssentiaWASM } from "essentia.js";

export type BpmWorkerRequest = {
  id: number;
  samples: Float32Array;
};

export type BpmWorkerResponse =
  | { id: number; ok: true; bpm: number; offset: number }
  | { id: number; ok: false; error: string };

let essentia: InstanceType<typeof Essentia> | null = null;

function getEssentia(): InstanceType<typeof Essentia> {
  if (!essentia) {
    // @ts-expect-error essentia.js ships untyped WASM constructor
    essentia = new Essentia(EssentiaWASM.EssentiaWASM);
  }
  return essentia;
}

self.onmessage = (e: MessageEvent<BpmWorkerRequest>) => {
  try {
    const { id, samples } = e.data;
    const es = getEssentia();
    const vec = es.arrayToVector(samples);
    const result = es.RhythmExtractor2013(vec);
    const ticks: Float32Array = es.vectorToArray(result.ticks);
    const offset = ticks.length > 0 ? ticks[0] : 0;
    const response: BpmWorkerResponse = {
      id,
      ok: true,
      bpm: Math.round(result.bpm * 10) / 10,
      offset,
    };
    self.postMessage(response);
  } catch (err) {
    const response: BpmWorkerResponse = {
      id: e.data.id,
      ok: false,
      error: String(err),
    };
    self.postMessage(response);
  }
};
