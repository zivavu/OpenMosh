import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { updateSettings } from "../editor/settings";
import {
	type FakeLocalStorage,
	installFakeLocalStorage,
} from "../testing/fake-storage";
import { isProxyDisabled, setProxyDisabled } from "./proxy-preference";

let ls: FakeLocalStorage;
beforeEach(() => {
	ls = installFakeLocalStorage();
});
afterEach(() => {
	ls.restore();
});

const video = (name: string) =>
	new File([new Uint8Array(16)], name, { type: "video/mp4", lastModified: 1 });

describe("proxy preference", () => {
	it("makes proxies by default", () => {
		expect(isProxyDisabled(video("a.mp4"))).toBe(false);
	});

	it("turns every video off with the setting", () => {
		updateSettings({ previewProxies: false });
		expect(isProxyDisabled(video("a.mp4"))).toBe(true);
	});

	it("keeps a file's own choice either way the setting goes", () => {
		const optedOut = video("out.mp4");
		setProxyDisabled(optedOut, true);
		updateSettings({ previewProxies: false });
		const optedIn = video("in.mp4");
		setProxyDisabled(optedIn, false);

		expect(isProxyDisabled(optedOut)).toBe(true);
		expect(isProxyDisabled(optedIn)).toBe(false);
		updateSettings({ previewProxies: true });
		expect(isProxyDisabled(optedOut)).toBe(true);
		expect(isProxyDisabled(optedIn)).toBe(false);
	});

	it("drops a choice that matches the setting", () => {
		const file = video("a.mp4");
		setProxyDisabled(file, true);
		setProxyDisabled(file, false);
		updateSettings({ previewProxies: false });
		expect(isProxyDisabled(file)).toBe(true);
	});
});
