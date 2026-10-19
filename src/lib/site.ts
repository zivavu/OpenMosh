/** Where OpenMosh lives. */
export const SITE_URL = "https://openmosh.com";

/** The first address. Saves there can't move on their own, so it keeps serving the app
 * with a notice rather than redirecting. */
const OLD_HOST = "open-mosh.vercel.app";

/** In dev, `?old-host` shows the notice too. */
export function onOldHost(): boolean {
	return (
		location.hostname === OLD_HOST ||
		(import.meta.env.DEV &&
			new URLSearchParams(location.search).has("old-host"))
	);
}
