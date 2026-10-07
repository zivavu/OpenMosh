import { expect, test, type Locator, type Page } from "@playwright/test";
import {
	clipMoshButton,
	liveEffectNames,
	liveEffects,
	mediaClips,
	openEditor,
	openSingle,
	poolCount,
	PREVIEW_CANVAS,
	selectClip,
	selectMode,
	splitClipAt,
	waitForRender,
	waitForSaved,
} from "./app";
import { BLUE, GREEN, RED } from "./fixtures";

/** A whole-browser backup carried into a second browser context, which has its own
 * IndexedDB and localStorage. Every stored record is compared byte for byte (blobs by
 * hash), then the projects are opened to show they still work. */

/** Everything the backup promises to carry, in a comparable form. */
async function dumpStorage(page: Page) {
	return page.evaluate(async () => {
		const sha = async (data: Blob | ArrayBuffer) => {
			const bytes = data instanceof Blob ? await data.arrayBuffer() : data;
			const digest = await crypto.subtle.digest("SHA-256", bytes);
			return [...new Uint8Array(digest)]
				.map((b) => b.toString(16).padStart(2, "0"))
				.join("");
		};
		const encode = async (value: unknown): Promise<unknown> => {
			if (value instanceof Blob)
				return { sha: await sha(value), size: value.size, type: value.type };
			if (value instanceof ArrayBuffer) return { sha: await sha(value) };
			if (Array.isArray(value)) return Promise.all(value.map(encode));
			if (value && typeof value === "object") {
				const out: Record<string, unknown> = {};
				for (const [k, v] of Object.entries(value)) out[k] = await encode(v);
				return out;
			}
			return value;
		};
		const ask = <T>(req: IDBRequest<T>) =>
			new Promise<T>((resolve, reject) => {
				req.onsuccess = () => resolve(req.result);
				req.onerror = () => reject(req.error);
			});

		const dbs: Record<string, Record<string, unknown[]>> = {};
		for (const name of [
			"openmosh-sequence-media",
			"openmosh-tracks",
			"openmosh-fonts",
		]) {
			const db = await ask(indexedDB.open(name));
			const stores: Record<string, unknown[]> = {};
			for (const store of db.objectStoreNames) {
				// Rebuilt per video on demand, so a backup leaves them out.
				if (store === "proxies") continue;
				const all = await ask(
					db.transaction(store).objectStore(store).getAll(),
				);
				stores[store] = await Promise.all(all.map(encode));
			}
			db.close();
			dbs[name] = stores;
		}

		const local: Record<string, unknown> = {};
		for (let i = 0; i < localStorage.length; i++) {
			const key = localStorage.key(i)!;
			if (!key.startsWith("openmosh")) continue;
			if (/^openmosh-(saved-sequences$|saved-sessions:|last-opened$)/.test(key))
				continue;
			const raw = localStorage.getItem(key)!;
			try {
				local[key] = JSON.parse(raw);
			} catch {
				local[key] = raw;
			}
		}
		return { dbs, local };
	});
}

/** A loaded font is re-added, so it gets a fresh id and timestamp; the rest must match. */
function withoutFontIdentity(dump: Awaited<ReturnType<typeof dumpStorage>>) {
	const fonts = dump.dbs["openmosh-fonts"].fonts as Record<string, unknown>[];
	dump.dbs["openmosh-fonts"].fonts = fonts.map(
		({ id: _id, addedAt: _addedAt, ...rest }) => rest,
	);
	return dump;
}

async function openStorage(page: Page): Promise<Locator> {
	await page.goto("/");
	await page.getByRole("button", { name: "Manage storage" }).click();
	const modal = page.getByRole("dialog", { name: "Storage" });
	await expect(modal).toBeVisible();
	await expect(modal.getByText("Reading…")).toHaveCount(0);
	return modal;
}

/** Add a font the way the font dialog does; a bundled face under a name of its own. */
async function addFont(page: Page): Promise<void> {
	await page.evaluate(async () => {
		const url: string = "/src/lib/text-overlay/custom-fonts.svelte.ts";
		const fonts = await import(/* @vite-ignore */ url);
		const data = await (
			await fetch("/fonts/abril-fatface.woff2")
		).arrayBuffer();
		await fonts.addCustomFontData(
			"Backup Test Face",
			"backup-test.woff2",
			data,
		);
	});
}

function failOnPageErrors(page: Page) {
	page.on("pageerror", (error) => {
		throw new Error(`uncaught page error: ${error.message}`);
	});
}

test("a backup loaded into another browser brings every byte back", async ({
	page,
	browser,
	baseURL,
}) => {
	failOnPageErrors(page);
	// The file picker is a native dialog Playwright can't drive; take the download path.
	await page.addInitScript(() => {
		Object.defineProperty(window, "showSaveFilePicker", {
			value: undefined,
			configurable: true,
		});
	});

	// A song-less single edit lives in the sessions store, not under a song.
	// First: once the editor has run, the start screen opens on it, not on Single.
	await openSingle(page, "lone.png", RED);
	await waitForRender(page);
	await page.getByRole("button", { name: "MOSH", exact: true }).click();
	await waitForSaved(page);

	await openEditor(page, {
		sources: [
			["red.png", RED],
			["green.png", GREEN],
			["blue.png", BLUE],
		],
		track: { name: "track.wav" },
	});
	await waitForRender(page);
	await splitClipAt(page, 0.5);
	await selectClip(page, 0);
	await clipMoshButton(page).click();
	await expect(liveEffects(page)).not.toHaveCount(0);
	const rolled = await liveEffectNames(page);
	await waitForSaved(page);

	await addFont(page);

	const modal = await openStorage(page);
	const downloadPromise = page.waitForEvent("download");
	await modal.getByRole("button", { name: "Download", exact: true }).click();
	const download = await downloadPromise;
	expect(download.suggestedFilename()).toMatch(/\.openmosh-backup$/);
	const backupPath = await download.path();
	const before = withoutFontIdentity(await dumpStorage(page));
	expect(before.dbs["openmosh-sequence-media"].media).toHaveLength(4);
	expect(before.dbs["openmosh-tracks"].tracks).toHaveLength(1);
	expect(before.dbs["openmosh-fonts"].fonts).toHaveLength(1);

	const origin = new URL(baseURL!).origin;
	const other = await browser.newContext({
		baseURL,
		storageState: {
			cookies: [],
			origins: [
				{
					origin,
					localStorage: [
						{
							name: "openmosh-settings",
							value: JSON.stringify({ demoBackground: false }),
						},
					],
				},
			],
		},
	});
	try {
		const target = await other.newPage();
		failOnPageErrors(target);
		const empty = await openStorage(target);
		await expect(empty.getByText("Nothing stored yet")).toBeVisible();

		const reloaded = target.waitForEvent("load");
		await empty
			.locator('input[accept=".openmosh-backup"]')
			.setInputFiles(backupPath);
		await reloaded;
		await expect(
			target.getByRole("button", { name: "Manage storage" }),
		).toBeVisible();

		const after = withoutFontIdentity(await dumpStorage(target));
		expect(after.dbs).toEqual(before.dbs);
		for (const [key, value] of Object.entries(before.local)) {
			expect(after.local[key], key).toEqual(value);
		}

		// And the work opens: the cuts, the pool and the moshed chain.
		await selectMode(target, "Editor");
		await expect(target.locator(".saved-item")).toHaveCount(1);
		await target.locator(".saved-item").first().click();
		await expect(target.locator(PREVIEW_CANVAS)).toBeVisible({
			timeout: 30_000,
		});
		await waitForRender(target);
		await expect(mediaClips(target)).toHaveCount(2);
		await expect(poolCount(target)).toHaveText(/^3\s+sources$/i);
		await selectClip(target, 0);
		expect(await liveEffectNames(target)).toEqual(rolled);

		await target.goto("/");
		await selectMode(target, "Single");
		await expect(target.locator(".saved-item")).toContainText("lone.png");
	} finally {
		await other.close();
	}
});

test("a file that isn't a backup is turned away and nothing is stored", async ({
	page,
}) => {
	failOnPageErrors(page);
	const modal = await openStorage(page);
	await modal.locator('input[accept=".openmosh-backup"]').setInputFiles({
		name: "nope.openmosh-backup",
		mimeType: "application/octet-stream",
		buffer: Buffer.from("not a zip"),
	});
	await expect(page.getByText("That isn't an OpenMosh backup")).toBeVisible();
	await expect(modal.getByText("Nothing stored yet")).toBeVisible();
});
