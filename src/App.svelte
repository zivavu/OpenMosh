<script lang="ts">
  import UploadScreen from './lib/components/UploadScreen.svelte';
  import Editor from './lib/components/Editor.svelte';

  let file: File | null = $state(null);
</script>

{#if file}
  <Editor {file} onBack={() => (file = null)} onfile={(f) => (file = f)} />
{:else}
  <UploadScreen onfile={(f) => (file = f)} />
{/if}
