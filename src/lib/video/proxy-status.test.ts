import { describe, expect, test } from "bun:test";
import { proxyStatus, shortRes } from "./proxy-status";

/** A QHD source, the size that gets a proxy in the first place. */
const SOURCE = { width: 2560, height: 1440 };

/** Stands in for the transcoded file; nothing here reads its contents. */
const FILE = new File([], "proxy.mp4", { type: "video/mp4" });

describe("proxyStatus", () => {
  test("says nothing about media with no proxy", () => {
    expect(proxyStatus(SOURCE).kind).toBe("none");
  });

  test("names the size it is working toward, and how far along", () => {
    const status = proxyStatus({
      ...SOURCE,
      proxyPending: true,
      proxyProgress: 0.42,
      proxyWidth: 1920,
      proxyHeight: 1080,
    });
    expect(status.kind).toBe("pending");
    expect(status).toMatchObject({ badge: "42%" });
    expect(status.kind === "pending" && status.title).toContain("1920×1080");
    expect(status.kind === "pending" && status.title).toContain("42%");
  });

  test("doesn't name a size before one has been picked", () => {
    const status = proxyStatus({ ...SOURCE, proxyPending: true });
    expect(status).toMatchObject({ kind: "pending", badge: "…" });
    expect(status.kind === "pending" && status.title).not.toContain("×");
  });

  test("reports both sizes once the proxy lands", () => {
    const status = proxyStatus({
      ...SOURCE,
      proxyFile: FILE,
      proxyWidth: 1920,
      proxyHeight: 1080,
    });
    expect(status).toMatchObject({ kind: "ready", badge: "1080p" });
    expect(status.kind === "ready" && status.title).toContain("1920×1080");
    expect(status.kind === "ready" && status.title).toContain("2560×1440");
  });

  test("still reads as ready when the proxy's size is unknown", () => {
    // Sessions stored before the size was recorded.
    expect(proxyStatus({ ...SOURCE, proxyFile: FILE }).kind).toBe("ready");
  });

  test("carries the failure reason, trimmed of its Error prefix", () => {
    const status = proxyStatus({
      ...SOURCE,
      proxyFailed: true,
      proxyReason: "Error: no usable tracks",
    });
    expect(status.kind).toBe("failed");
    expect(status.kind === "failed" && status.title).toContain(
      "no usable tracks",
    );
    expect(status.kind === "failed" && status.title).not.toContain("Error:");
  });

  test("still explains a failure that came with no reason", () => {
    const status = proxyStatus({ ...SOURCE, proxyFailed: true });
    expect(status.kind === "failed" && status.title).toContain("2560×1440");
  });

  test("says the preview is on the original once the user turns it off", () => {
    const status = proxyStatus({ ...SOURCE, proxyDisabled: true });
    expect(status).toMatchObject({ kind: "off", badge: "1440p" });
    expect(status.kind === "off" && status.title).toContain("2560×1440");
    expect(status.kind === "off" && status.action.kind).toBe("enable");
  });

  test("the choice outranks a transcode still winding down", () => {
    const status = proxyStatus({
      ...SOURCE,
      proxyDisabled: true,
      proxyPending: true,
      proxyProgress: 0.6,
      proxyFile: FILE,
    });
    expect(status.kind).toBe("off");
  });

  test("offers to turn it off while running and once it has landed", () => {
    const running = proxyStatus({ ...SOURCE, proxyPending: true });
    const ready = proxyStatus({ ...SOURCE, proxyFile: FILE });
    expect(running.kind === "pending" && running.action.kind).toBe("disable");
    expect(ready.kind === "ready" && ready.action.kind).toBe("disable");
  });

  test("offers a retry, not a toggle, after a failure", () => {
    const status = proxyStatus({ ...SOURCE, proxyFailed: true });
    expect(status.kind === "failed" && status.action.kind).toBe("retry");
  });

  test("falls back to 'full size' for media with no probed dimensions", () => {
    const status = proxyStatus({ proxyFailed: true });
    expect(status.kind === "failed" && status.title).toContain("full size");
  });
});

describe("shortRes", () => {
  test("rounds down to the nearest familiar rung", () => {
    expect(shortRes(1080)).toBe("1080p");
    expect(shortRes(1076)).toBe("720p"); // A cropped 1080-ish proxy.
    expect(shortRes(2160)).toBe("2160p");
  });

  test("names an unusually short frame by its own height", () => {
    expect(shortRes(240)).toBe("240p");
  });
});
