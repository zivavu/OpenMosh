// Offline copy of the app. The build prepends PRECACHE (every file it wrote but the
// fonts) and VERSION (a hash of their contents), so a deploy gets its own
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
			fetch(request).catch(() => offlinePage(new URL(request.url).pathname)),
		);
		return;
	}
	event.respondWith(
		caches.match(request).then((hit) => hit ?? fetchAndKeep(request)),
	);
});

/** The precached page for a path: the app, a static page, or the 404. */
async function offlinePage(path) {
	const page =
		path === "/" || path === "/index.html"
			? "/index.html"
			: `${path.replace(/\/$/, "")}/index.html`;
	return (
		(await caches.match(page)) ??
		(await caches.match("/404.html")) ??
		(await caches.match("/index.html")) ??
		Response.error()
	);
}

// Fonts aren't in PRECACHE; one is kept the first time a text clip asks for it.
async function fetchAndKeep(request) {
	const response = await fetch(request);
	if (response.ok && new URL(request.url).pathname.startsWith("/fonts/")) {
		const copy = response.clone();
		caches.open(CACHE).then((cache) => cache.put(request, copy));
	}
	return response;
}
