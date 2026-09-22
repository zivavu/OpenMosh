import { describe, expect, test } from "bun:test";
import { lazy } from "./lazy";

describe("lazy", () => {
	test("loads once and reuses the result", async () => {
		let calls = 0;
		const load = lazy(async () => ({ default: ++calls }));
		expect(await load()).toBe(1);
		expect(await load()).toBe(1);
		expect(calls).toBe(1);
	});

	test("retries after a failed load", async () => {
		let calls = 0;
		const load = lazy(async () => {
			if (++calls === 1) throw new Error("chunk 404");
			return { default: "ok" };
		});
		await expect(load()).rejects.toThrow("chunk 404");
		expect(await load()).toBe("ok");
		expect(calls).toBe(2);
	});
});
