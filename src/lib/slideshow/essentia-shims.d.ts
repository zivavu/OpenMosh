declare module 'essentia.js' {
	class Essentia {
		constructor(wasmModule: any);
		audioBufferToMonoSignal(buffer: AudioBuffer): Float32Array;
		arrayToVector(array: Float32Array): any;
		vectorToArray(vector: any): Float32Array;
		RhythmExtractor2013(
			signal: any,
			maxTempo?: number,
			method?: string,
			minTempo?: number,
		): {
			bpm: number;
			ticks: any;
			confidence: number;
			estimates: any;
			bpmIntervals: any;
		};
	}

	const EssentiaWASM: () => Promise<any>;

	export { Essentia, EssentiaWASM };
}

declare module 'essentia.js/dist/essentia-wasm.umd.js' {
	const EssentiaWASM: () => Promise<any>;
	export default EssentiaWASM;
}
