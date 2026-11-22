<script lang="ts">
	import { MessageSquare } from "lucide-svelte";
	import { openFeedback } from "./feedback.svelte";
	import RoundButton from "./RoundButton.svelte";
</script>

<RoundButton title="Send feedback" onclick={() => openFeedback()}>
	<MessageSquare size={14} />
</RoundButton>
