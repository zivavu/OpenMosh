/** Where OpenMosh lives. */
export const SITE_URL = "https://openmosh.com";

/** The first address. Saves there can't move on their own, so it keeps serving the app
 * with a notice rather than redirecting. */
const OLD_HOST = "open-mosh.vercel.app";

export function onOldHost(): boolean {
	return location.hostname === OLD_HOST;
}
