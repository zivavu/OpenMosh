import { describe, expect, it } from "bun:test";
import {
	dismissToast,
	getToasts,
	holdToast,
	releaseToast,
	showToast,
	updateToast,
} from "./toast.svelte";

const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));

describe("updateToast", () => {
	it("turns a toast into another where it stands", () => {
		const before = showToast("first", "info", 0);
		const id = showToast("Building…", "info", 0);
		const after = showToast("last", "info", 0);
		expect(updateToast(id, "Saved", "success", 0)).toBe(id);
		expect(getToasts().map((t) => [t.message, t.type])).toEqual([
			["first", "info"],
			["Saved", "success"],
			["last", "info"],
		]);
		for (const t of [before, id, after]) dismissToast(t);
	});

	it("shows it fresh once the toast was dismissed", () => {
		const id = showToast("Building…", "info", 0);
		dismissToast(id);
		const shown = updateToast(id, "Saved", "success", 0);
		expect(shown).not.toBe(id);
		expect(getToasts().map((t) => t.message)).toEqual(["Saved"]);
		dismissToast(shown);
	});

	it("drops the old timer, so a progress toast outlives its first duration", async () => {
		const id = showToast("Building…", "info", 20);
		updateToast(id, "Saved", "success", 0);
		await new Promise((r) => setTimeout(r, 40));
		expect(getToasts().map((t) => t.message)).toEqual(["Saved"]);
		dismissToast(id);
	});
});

describe("holdToast", () => {
	it("keeps a toast up past its duration while held", async () => {
		const id = showToast("Removed", "info", 20);
		holdToast(id);
		await wait(40);
		expect(getToasts().map((t) => t.id)).toContain(id);
		dismissToast(id);
	});

	it("runs out once let go, after the floor a let-go toast gets", async () => {
		const id = showToast("Removed", "info", 20);
		holdToast(id);
		await wait(40);
		releaseToast(id);
		await wait(40);
		expect(getToasts().map((t) => t.id)).toContain(id);
		dismissToast(id);
	});

	it("waits for every hold to end, pointer and focus alike", async () => {
		const id = showToast("Removed", "info", 2000);
		holdToast(id);
		holdToast(id);
		releaseToast(id);
		await wait(20);
		expect(getToasts().map((t) => t.id)).toContain(id);
		dismissToast(id);
	});

	it("holds a progress toast that turns into done under the pointer", async () => {
		const id = showToast("Building…", "info", 0);
		holdToast(id);
		updateToast(id, "Saved", "success", 20);
		await wait(40);
		expect(getToasts().map((t) => t.message)).toContain("Saved");
		dismissToast(id);
	});

	it("leaves an untimed toast alone", () => {
		const id = showToast("Building…", "info", 0);
		holdToast(id);
		releaseToast(id);
		expect(getToasts().map((t) => t.id)).toContain(id);
		dismissToast(id);
	});
});
