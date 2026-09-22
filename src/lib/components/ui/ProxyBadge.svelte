<script lang="ts">
	import { TriangleAlert, Zap, ZapOff } from "lucide-svelte";
	import {
		proxyStatus,
		type ProxyAction,
		type ProxyStatusInput,
	} from "../../video/proxy-status";

	/**
	 * A video's preview-proxy state as one chip, same icon and wording everywhere.
	 * A button when the surface takes the click, a span otherwise; the owner positions it.
	 */
	interface Props {
		source: ProxyStatusInput;
		size?: number;
		onAction?: (action: ProxyAction["kind"]) => void;
	}

	let { source, size = 9, onAction }: Props = $props();

	let proxy = $derived(proxyStatus(source));
</script>

{#if proxy.kind !== "none"}
	{#if onAction}
		<button
			class="proxy-badge"
			class:ok={proxy.kind === "ready"}
			class:warn={proxy.kind === "failed"}
			class:off={proxy.kind === "off"}
			title={`${proxy.title} ${proxy.action.hint}`}
			onclick={(e) => {
				e.stopPropagation();
				onAction(proxy.action.kind);
			}}
		>
			{@render body()}
		</button>
	{:else}
		<span
			class="proxy-badge"
			class:ok={proxy.kind === "ready"}
			class:warn={proxy.kind === "failed"}
			class:off={proxy.kind === "off"}
			title={proxy.title}
		>
			{@render body()}
		</span>
	{/if}
{/if}

{#snippet body()}
	{#if proxy.kind === "ready"}
		<Zap {size} fill="currentColor" />
		{proxy.badge}
	{:else if proxy.kind === "off"}
		<ZapOff {size} />
		{proxy.badge}
	{:else if proxy.kind === "failed"}
		<TriangleAlert {size} />
	{:else if proxy.kind === "pending"}
		{proxy.badge}
	{/if}
{/snippet}

<style>
	.proxy-badge {
		display: flex;
		align-items: center;
		gap: 3px;
		padding: 1px 4px;
		border: none;
		border-radius: 2px;
		background: rgba(0, 0, 0, 0.65);
		color: var(--text-3);
		font-family: var(--font-mono);
		font-size: 0.55rem;
		line-height: 1.5;
	}

	button.proxy-badge {
		cursor: pointer;
	}

	.proxy-badge.ok {
		color: var(--live);
	}

	.proxy-badge.warn {
		color: var(--start);
	}

	.proxy-badge.off {
		color: var(--text-4);
	}
</style>
