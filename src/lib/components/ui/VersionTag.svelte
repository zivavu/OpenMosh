<script lang="ts">
	import {
		APP_CHANNEL,
		APP_COMMIT,
		APP_VERSION,
		buildLabel,
		buildLink,
	} from "../../build-info";
	import RoundButton from "./RoundButton.svelte";

	const label = buildLabel(APP_VERSION, APP_CHANNEL, APP_COMMIT);
	const href = buildLink(APP_VERSION, APP_CHANNEL, APP_COMMIT);
	const title =
		APP_CHANNEL === "release"
			? `What's new in v${APP_VERSION}`
			: APP_CHANNEL === "preview"
				? `Unreleased work after v${APP_VERSION}. Opens the commit this preview was built from.`
				: `Local build. v${APP_VERSION} is the last release.`;
</script>

<RoundButton pill {href} {title}>{label}</RoundButton>
