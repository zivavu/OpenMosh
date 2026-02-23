<script lang="ts">
  interface Props {
    src: string;
  }

  let { src }: Props = $props();
</script>

<div class="preview-area">
  <img class="preview-image" {src} alt="Loaded image" />
</div>

<style>
  .preview-area {
    flex: 1;
    display: flex;
    align-items: center;
    justify-content: center;
    overflow: hidden;
    padding: 1.5rem;
  }

  .preview-image {
    max-width: 100%;
    max-height: 100%;
    object-fit: contain;
    border-radius: 2px;
    box-shadow: 0 4px 24px rgba(0, 0, 0, 0.5);
  }
</style>
