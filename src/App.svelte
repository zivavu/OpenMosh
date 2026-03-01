<script lang="ts">
  import UploadScreen from './lib/components/UploadScreen.svelte';
  import Editor from './lib/components/Editor.svelte';
  import SlideshowEditor from './lib/components/SlideshowEditor.svelte';

  let file: File | null = $state(null);
  let slideshowFiles: File[] = $state([]);
</script>

{#if slideshowFiles.length > 0}
  <SlideshowEditor
    initialFiles={slideshowFiles}
    onBack={() => { slideshowFiles = []; }}
  />
{:else if file}
  <Editor {file} onBack={() => (file = null)} onfile={(f) => (file = f)} />
{:else}
  <UploadScreen
    onfile={(f) => (file = f)}
    onSlideshow={(files) => { slideshowFiles = files; }}
  />
{/if}
