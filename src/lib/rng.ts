export type Rand = () => number;

/** Deterministic PRNG (mulberry32) so a batch can be re-planned from its seed. */
export function mulberry32(seed: number): Rand {
	let a = seed >>> 0;
	return () => {
		a = (a + 0x6d2b79f5) >>> 0;
		let t = Math.imul(a ^ (a >>> 15), 1 | a);
		t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
		return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
	};
}

export function randIn(rng: Rand, min: number, max: number): number {
	return min + rng() * (max - min);
}

/** Uniform in log space, the right shape for zoom-like parameters. */
export function randLog(rng: Rand, min: number, max: number): number {
	return Math.exp(randIn(rng, Math.log(min), Math.log(max)));
}

export function pick<T>(rng: Rand, items: readonly T[]): T {
	return items[Math.floor(rng() * items.length)];
}

export function shuffle<T>(rng: Rand, arr: T[]): T[] {
	for (let i = arr.length - 1; i > 0; i--) {
		const j = Math.floor(rng() * (i + 1));
		[arr[i], arr[j]] = [arr[j], arr[i]];
	}
	return arr;
}

/** A fresh 32-bit seed for a new batch. */
export function randomSeed(): number {
	return (Math.random() * 0xffffffff) >>> 0;
}
