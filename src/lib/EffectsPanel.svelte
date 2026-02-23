<script lang="ts">
  import EffectItem from './EffectItem.svelte';
  import {
    type EffectInstance,
    getDefinition,
    createEffectInstance,
  } from './effects';

  interface Props {
    effects: EffectInstance[];
  }

  let { effects = $bindable() }: Props = $props();

  function toggle(index: number) {
    effects[index].enabled = !effects[index].enabled;
  }

  function toggleLock(index: number) {
    effects[index].locked = !effects[index].locked;
  }

  function toggleExpand(index: number) {
    effects[index].expanded = !effects[index].expanded;
  }

  function reset(index: number) {
    const def = getDefinition(effects[index].defId);
    if (!def) return;
    effects[index].values = Object.fromEntries(
      def.params.map((p) => [p.key, p.defaultValue]),
    );
    effects[index].enabled = false;
  }

  function duplicate(index: number) {
    const source = effects[index];
    const def = getDefinition(source.defId);
    if (!def) return;
    const copy = createEffectInstance(def);
    copy.enabled = source.enabled;
    copy.values = { ...source.values };
    effects.splice(index + 1, 0, copy);
  }

  function remove(index: number) {
    const remaining = effects.filter((e) => e.defId === effects[index].defId);
    if (remaining.length > 1) {
      effects.splice(index, 1);
    } else {
      reset(index);
    }
  }

  function paramChange(index: number, key: string, value: number | string) {
    effects[index].values[key] = value;
  }
</script>

<aside class="effects-panel">
  <div class="panel-scroll">
    {#each effects as effect, i (effect.instanceId)}
      <EffectItem
        {effect}
        onToggle={() => toggle(i)}
        onToggleLock={() => toggleLock(i)}
        onToggleExpand={() => toggleExpand(i)}
        onReset={() => reset(i)}
        onDuplicate={() => duplicate(i)}
        onRemove={() => remove(i)}
        onParamChange={(key, value) => paramChange(i, key, value)}
      />
    {/each}
  </div>
</aside>

<style>
  .effects-panel {
    width: 280px;
    height: 100%;
    background: #161616;
    border-left: 1px solid #1e1e1e;
    display: flex;
    flex-direction: column;
    flex-shrink: 0;
  }

  .panel-scroll {
    flex: 1;
    overflow-y: auto;
    overflow-x: hidden;
  }

  .panel-scroll::-webkit-scrollbar {
    width: 4px;
  }

  .panel-scroll::-webkit-scrollbar-track {
    background: transparent;
  }

  .panel-scroll::-webkit-scrollbar-thumb {
    background: #333;
    border-radius: 2px;
  }

  .panel-scroll::-webkit-scrollbar-thumb:hover {
    background: #555;
  }
</style>
