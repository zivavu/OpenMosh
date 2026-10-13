import { describe, expect, it } from "bun:test";
import {
	dismissToast,
	getToasts,
	showToast,
	updateToast,
} from "./toast.svelte";

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
