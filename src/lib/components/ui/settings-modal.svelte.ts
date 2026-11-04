/** Mounted once at the app root, like the feedback modal; any top bar opens it. */
let open = $state(false);

export function isSettingsOpen() {
	return open;
}

export function openSettings() {
	open = true;
}

export function closeSettings() {
	open = false;
}
