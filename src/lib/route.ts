/** The app's hash routes. Each editor's names the saved edit it has open:
 * `#editor/<id>`, `#single/<id>`, `#slideshow/<id>`. */

// Named for what each view is, not for the route it answers to: the two stopped
// matching when the segment editor took the "#editor" name.
export type View = "upload" | "single" | "sequence" | "slideshow";

export interface Route {
	view: View;
	/** What the linked edit is saved under. */
	key: string | null;
}

/** The segment editor is "#editor" now, though internally it is still "sequence": the
 * mode's saved timelines, media pool and sessions are keyed under that word. */
const VIEW_HASH: Record<View, string> = {
	upload: "#",
	single: "#single",
	sequence: "#editor",
	slideshow: "#slideshow",
};

function pathToView(path: string): View {
	switch (path) {
		case "#slideshow":
			return "slideshow";
		// "#sequence" is the route this mode used to answer to; kept so links and
		// bookmarks from before the rename still land in it.
		case "#editor":
		case "#sequence":
			return "sequence";
		case "#single":
			return "single";
		default:
			return "upload";
	}
}

function decodeId(id: string): string | null {
	try {
		return decodeURIComponent(id) || null;
	} catch {
		return null;
	}
}

// A link carries the id alone; the key adds a prefix (`proj-<id>`, `single:p:<id>`).
// Older edits keyed by their song or file get no link.
const KEY_PREFIX: Record<View, string | null> = {
	upload: null,
	sequence: "proj-",
	single: "single:p:",
	slideshow: "slideshow:p:",
};

function keyFromId(view: View, id: string): string | null {
	const prefix = KEY_PREFIX[view];
	return prefix === null ? null : prefix + id;
}

function idFromKey(view: View, key: string): string | null {
	const prefix = KEY_PREFIX[view];
	return prefix !== null && key.startsWith(prefix)
		? key.slice(prefix.length)
		: null;
}

export function parseRoute(hash: string): Route {
	const slash = hash.indexOf("/");
	const view = pathToView(slash < 0 ? hash : hash.slice(0, slash));
	const id = slash < 0 ? null : decodeId(hash.slice(slash + 1));
	return { view, key: id ? keyFromId(view, id) : null };
}

export function routeHash(view: View, key: string | null = null): string {
	const id = key ? idFromKey(view, key) : null;
	return id ? `${VIEW_HASH[view]}/${encodeURIComponent(id)}` : VIEW_HASH[view];
}
