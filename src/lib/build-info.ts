/** What this build is, baked in by vite.config.ts. */

declare const __APP_VERSION__: string;
declare const __APP_CHANNEL__: BuildChannel;
declare const __APP_COMMIT__: string | null;

/** A tagged release, a Vercel preview of unreleased work, or a local build. */
export type BuildChannel = "release" | "preview" | "local";

// Only a Vite build defines these; bun:test imports this file without them.
const baked = typeof __APP_VERSION__ === "string";
export const APP_VERSION = baked ? __APP_VERSION__ : "0.0.0";
export const APP_CHANNEL: BuildChannel = baked ? __APP_CHANNEL__ : "local";
export const APP_COMMIT = baked ? __APP_COMMIT__ : null;

export const REPO_URL = "https://github.com/zivavu/OpenMosh";

/** A preview points at the commit it was built from; everything else at its release notes. */
export function buildLink(
	version: string,
	channel: BuildChannel,
	commit: string | null,
): string {
	return channel === "preview" && commit
		? `${REPO_URL}/commit/${commit}`
		: `${REPO_URL}/releases/tag/v${version}`;
}

/** The tag's text: the version, plus which build when it isn't a release. */
export function buildLabel(
	version: string,
	channel: BuildChannel,
	commit: string | null,
): string {
	if (channel === "release") return `v${version}`;
	if (channel === "preview") {
		return commit
			? `v${version} preview ${commit.slice(0, 7)}`
			: `v${version} preview`;
	}
	return `v${version} dev`;
}
