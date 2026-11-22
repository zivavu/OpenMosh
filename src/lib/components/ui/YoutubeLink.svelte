<script lang="ts">
	import { Icon } from "lucide-svelte";
	import { youtubeIcon } from "./brand-icons";
	import RoundButton from "./RoundButton.svelte";
</script>

<RoundButton
	class="youtube-link"
	href="https://www.youtube.com/@zivavu144"
	title="See what's been made with OpenMosh"
>
	<Icon iconNode={youtubeIcon} size={14} />
</RoundButton>
