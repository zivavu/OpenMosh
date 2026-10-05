import { describe, expect, it } from "bun:test";
import type { ParamHistory } from "../../effects/mask-paint.svelte";
import { boxUv, createParamSession, uvPoint } from "./mask-tools";

describe("boxUv and uvPoint", () => {
	it("undo each other on a turned box", () => {
		const box = { left: 40, top: 10, w: 300, h: 160, rot: 0.6 };
		const p = uvPoint(box, 0.2, 0.85);
		const back = boxUv(box, p.x, p.y);
		expect(back.u).toBeCloseTo(0.2);
		expect(back.v).toBeCloseTo(0.85);
	});
});

describe("createParamSession", () => {
	function session() {
		const writes: [string, ParamHistory][] = [];
		const s = createParamSession("a", (v, h) => writes.push([v, h]));
		return { s, writes };
	}

	it("gives the editor's history one entry for the whole session", () => {
		const { s, writes } = session();
		s.save("b");
		s.save("c");
		expect(writes.map(([, h]) => h)).toEqual(["new", "none"]);
	});

	it("undoes a step at a time and never past where it began", () => {
		const { s } = session();
		s.save("b");
		s.save("c", true);
		s.save("d");
		// "c" rode on "b"'s step, so one undo takes both back.
		expect(s.undo()).toBe("c");
		expect(s.undo()).toBe("a");
		expect(s.undo()).toBeNull();
		expect(s.redo()).toBe("c");
		expect(s.value).toBe("c");
	});

	it("drops the redo branch on a fresh step", () => {
		const { s } = session();
		s.save("b");
		s.undo();
		s.save("c");
		expect(s.redo()).toBeNull();
	});
});
