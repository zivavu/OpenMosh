declare module "essentia.js" {
  type EssentiaVector = { readonly __brand: "EssentiaVector" };

  class Essentia {
    constructor(wasmModule: any);
    audioBufferToMonoSignal(buffer: AudioBuffer): Float32Array;
    arrayToVector(array: Float32Array): EssentiaVector;
    vectorToArray(vector: EssentiaVector): Float32Array;
    RhythmExtractor2013(
      signal: EssentiaVector,
      maxTempo?: number,
      method?: string,
      minTempo?: number,
    ): {
      bpm: number;
      ticks: EssentiaVector;
      confidence: number;
      estimates: EssentiaVector;
      bpmIntervals: EssentiaVector;
    };
  }

  const EssentiaWASM: () => Promise<any>;

  export { Essentia, EssentiaWASM };
}
