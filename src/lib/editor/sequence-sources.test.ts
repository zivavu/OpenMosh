import { expect, test } from "bun:test";
import {
	SequenceSourceRegistry,
	type SequenceSource,
} from "./sequence-sources.svelte";

// Bun has no createImageBitmap, so every image here is one the browser can't read.
test("an image that won't decode leaves the pool and is reported once", async () => {
	const calls: SequenceSource[][] = [];
	let reported!: () => void;
	const done = new Promise<void>((resolve) => (reported = resolve));
	const registry = new SequenceSourceRegistry(undefined, undefined, (s) => {
		calls.push(s);
		reported();
	});
	const added = await registry.add(
		[
			new File(["a"], "a.heic", { type: "image/heic" }),
			new File(["b"], "b.png", { type: "image/png" }),
		],
		{ persist: false },
	);
	expect(added).toHaveLength(2);
	await done;
	expect(calls).toHaveLength(1);
	expect(calls[0].map((s) => s.name).sort()).toEqual(["a.heic", "b.png"]);
	expect(registry.sources).toHaveLength(0);
});
