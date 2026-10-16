<script lang="ts">
	import { Icon } from "lucide-svelte";
	import { githubIcon } from "./brand-icons";
</script>

<a
	class="github-link"
	href="https://github.com/zivavu/OpenMosh"
	target="_blank"
	rel="noopener noreferrer"
	title="View on GitHub"
	aria-label="View on GitHub"
>
	<Icon iconNode={githubIcon} size={14} />
</a>

<style>
	.github-link {
		display: flex;
		align-items: center;
		justify-content: center;
		width: 30px;
		height: 30px;
		border-radius: 50%;
		background: rgba(18, 18, 18, 0.85);
		border: 1.5px solid var(--line-strong);
		color: var(--text-3);
		flex-shrink: 0;
		box-sizing: border-box;
		transition:
			border-color 0.2s,
			color 0.2s;
	}

	.github-link:hover {
		border-color: var(--text-3);
		color: var(--text);
	}
</style>
