import { describe, expect, it } from "bun:test";
import { EDGE_ZONE_PX, edgeOvershoot, edgeScrollSpeed } from "./edge-scroll";

describe("edgeOvershoot", () => {
	it("is zero away from both edges", () => {
		expect(edgeOvershoot(500, 100, 900)).toBe(0);
	});

	it("is negative towards the left and positive towards the right", () => {
		expect(edgeOvershoot(100, 100, 900)).toBe(-EDGE_ZONE_PX);
		expect(edgeOvershoot(900, 100, 900)).toBe(EDGE_ZONE_PX);
	});

	it("keeps growing past the lane", () => {
		expect(edgeOvershoot(40, 100, 900)).toBe(-60 - EDGE_ZONE_PX);
		expect(edgeOvershoot(1000, 100, 900)).toBe(100 + EDGE_ZONE_PX);
	});

	it("never scrolls a lane too narrow for both zones", () => {
		expect(edgeOvershoot(0, 0, EDGE_ZONE_PX * 2)).toBe(0);
	});
});

describe("edgeScrollSpeed", () => {
	it("stands still at the zone's inner edge", () => {
		expect(edgeScrollSpeed(0)).toBe(0);
	});

	it("speeds up faster than the distance grows", () => {
		const near = edgeScrollSpeed(10);
		const far = edgeScrollSpeed(100);
		expect(far / near).toBeGreaterThan(10);
		expect(edgeScrollSpeed(-100)).toBe(far);
	});

	it("tops out", () => {
		expect(edgeScrollSpeed(10_000)).toBe(edgeScrollSpeed(20_000));
	});
});
