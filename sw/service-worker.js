// Offline copy of the app. The build prepends PRECACHE (every file it wrote) and
// VERSION (a hash of their names, which are content-hashed), so a deploy gets its own
// cache. There's no skipWaiting: a new version takes over only once every tab on the
// old one has closed, so an open tab keeps finding the chunks it lazy-loads.
/* global PRECACHE, VERSION */

const CACHE = `openmosh-${VERSION}`;

self.addEventListener("install", (event) => {
	event.waitUntil(caches.open(CACHE).then((cache) => cache.addAll(PRECACHE)));
});

self.addEventListener("activate", (event) => {
	event.waitUntil(
		caches
			.keys()
			.then((keys) =>
				Promise.all(
					keys
						.filter((key) => key.startsWith("openmosh-") && key !== CACHE)
						.map((key) => caches.delete(key)),
				),
			)
			.then(() => self.clients.claim()),
	);
});

self.addEventListener("fetch", (event) => {
	const request = event.request;
	if (request.method !== "GET") return;
	if (new URL(request.url).origin !== self.location.origin) return;

	// Pages go to the network first, so a deploy shows up on the next load.
	if (request.mode === "navigate") {
		event.respondWith(
			fetch(request).catch(() =>
				caches.match("/index.html").then((hit) => hit ?? Response.error()),
			),
		);
		return;
	}
	event.respondWith(caches.match(request).then((hit) => hit ?? fetch(request)));
});
