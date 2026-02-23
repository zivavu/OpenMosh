<script lang="ts">
  import UploadScreen from './lib/UploadScreen.svelte';

  let file: File | null = $state(null);

  function onFile(f: File) {
    file = f;
  }
</script>

{#if file}
  <main class="editor">
    <!-- Editor will go here -->
  </main>
{:else}
  <UploadScreen onfile={onFile} />
{/if}
