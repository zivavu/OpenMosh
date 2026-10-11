import { describe, expect, it } from "bun:test";
import { GeneratedSizeSync } from "./size-sync";

describe("GeneratedSizeSync", () => {
	it("re-renders a tracked entry at the new size", async () => {
		const applied: string[] = [];
		const sync = new GeneratedSizeSync((id) => applied.push(id));
		const sizes: string[] = [];
		sync.track(
			"a",
			async (w, h) => {
				sizes.push(`${w}x${h}`);
				return new Blob(["x"]);
			},
			10,
			10,
		);
		sync.resize(20, 30);
		await sync.settle();
		sync.dispose();
		expect(sizes).toEqual(["20x30"]);
		expect(applied).toEqual(["a"]);
	});

	it("settles when a render keeps failing, without retrying it", async () => {
		const applied: string[] = [];
		const sync = new GeneratedSizeSync((id) => applied.push(id));
		let calls = 0;
		sync.track(
			"a",
			async () => {
				calls++;
				throw new Error("too big");
			},
			0,
			0,
		);
		sync.resize(10000, 10000);
		await sync.settle();
		sync.dispose();
		expect(calls).toBe(1);
		expect(applied).toEqual([]);
	});

	it("survives a render that throws before it returns a promise", async () => {
		const sync = new GeneratedSizeSync(() => {});
		let calls = 0;
		sync.track(
			"a",
			() => {
				calls++;
				throw new Error("no WebGL2");
			},
			0,
			0,
		);
		sync.resize(100, 100);
		await sync.settle();
		sync.dispose();
		expect(calls).toBe(1);
	});
});
