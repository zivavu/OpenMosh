<script lang="ts">
	import { Icon } from "lucide-svelte";
	import { instagramIcon } from "./brand-icons";
	import RoundButton from "./RoundButton.svelte";
</script>

<RoundButton
	class="instagram-link"
	href="https://www.instagram.com/zivavu144/"
	title="Moshes on Instagram"
>
	<Icon iconNode={instagramIcon} size={14} />
</RoundButton>
