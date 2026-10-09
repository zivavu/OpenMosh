import { describe, expect, it } from "bun:test";
import { isSvgFile, svgAspect, svgFit } from "./svg";

const root = (attrs: Record<string, string>) =>
	({ getAttribute: (k: string) => attrs[k] ?? null }) as unknown as Element;

describe("svgAspect", () => {
	it("prefers the viewBox", () => {
		expect(
			svgAspect(root({ viewBox: "0 0 200 100", width: "10", height: "10" })),
		).toBe(2);
	});

	it("falls back to plain width and height, and then to square", () => {
		expect(svgAspect(root({ width: "30px", height: "60" }))).toBe(0.5);
		expect(svgAspect(root({ width: "100%", height: "50%" }))).toBe(1);
	});
});

describe("svgFit", () => {
	it("fits inside the box at its own shape", () => {
		expect(svgFit(2, 1920, 1080)).toEqual({ width: 1920, height: 960 });
		expect(svgFit(0.5, 1920, 1080)).toEqual({ width: 540, height: 1080 });
	});
});

describe("isSvgFile", () => {
	it("goes by type or name", () => {
		expect(isSvgFile(new File([], "logo.SVG"))).toBe(true);
		expect(isSvgFile(new File([], "x", { type: "image/svg+xml" }))).toBe(true);
		expect(isSvgFile(new File([], "a.png", { type: "image/png" }))).toBe(false);
	});
});
