<script lang="ts">
	import {
		APP_CHANNEL,
		APP_COMMIT,
		APP_VERSION,
		buildLabel,
		buildLink,
	} from "../../build-info";

	const label = buildLabel(APP_VERSION, APP_CHANNEL, APP_COMMIT);
	const href = buildLink(APP_VERSION, APP_CHANNEL, APP_COMMIT);
	const title =
		APP_CHANNEL === "release"
			? `What's new in v${APP_VERSION}`
			: APP_CHANNEL === "preview"
				? `Unreleased work after v${APP_VERSION}. Opens the commit this preview was built from.`
				: `Local build. v${APP_VERSION} is the last release.`;
</script>

<a class="version-tag" {href} {title} target="_blank" rel="noopener noreferrer"
	>{label}</a
>

<style>
	/* Pill-shaped and sized like the round links beside it. */
	.version-tag {
		display: flex;
		align-items: center;
		height: 30px;
		padding: 0 0.75rem;
		border-radius: var(--r-pill);
		background: rgba(18, 18, 18, 0.85);
		border: 1.5px solid var(--line-strong);
		box-sizing: border-box;
		color: var(--text-3);
		font-family: var(--font-mono);
		font-size: 0.7rem;
		letter-spacing: 0.02em;
		text-decoration: none;
		white-space: nowrap;
		transition:
			border-color 0.2s,
			color 0.2s;
	}

	.version-tag:hover {
		border-color: var(--text-3);
		color: var(--text);
	}
</style>
