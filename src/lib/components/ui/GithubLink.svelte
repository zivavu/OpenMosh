<script lang="ts">
	import { Icon } from "lucide-svelte";
	import { githubIcon } from "./brand-icons";
	import RoundButton from "./RoundButton.svelte";
</script>

<RoundButton
	class="github-link"
	href="https://github.com/zivavu/OpenMosh"
	title="View on GitHub"
>
	<Icon iconNode={githubIcon} size={14} />
</RoundButton>
