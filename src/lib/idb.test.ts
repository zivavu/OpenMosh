import "fake-indexeddb/auto";
import { expect, test } from "bun:test";
import { request, transact } from "./idb";

test("a failed request rejects with its error, not null", async () => {
	const open = indexedDB.open("idb-test", 1);
	open.onupgradeneeded = () =>
		open.result.createObjectStore("s", { keyPath: "id" });
	const db = await request(open);
	const failed = await transact(db, "s", "readwrite", (tx) => {
		const store = tx.objectStore("s");
		store.add({ id: 1 });
		store.add({ id: 1 });
	}).catch((e: unknown) => e);
	db.close();
	expect(failed).toBeInstanceOf(Error);
});
