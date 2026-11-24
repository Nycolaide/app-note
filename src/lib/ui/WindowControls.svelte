<script lang="ts">
  import { getCurrentWindow } from "@tauri-apps/api/window";
  import { Minus, Square, X } from "@lucide/svelte";

  const appWindow = getCurrentWindow();
</script>

<div class="window-controls">
  <button type="button" aria-label="Réduire" onclick={() => appWindow.minimize()}><Minus size={14} strokeWidth={2.5} /></button>
  <button type="button" aria-label="Agrandir" onclick={() => appWindow.toggleMaximize()}><Square size={11} strokeWidth={2.5} /></button>
  <button type="button" aria-label="Fermer" onclick={() => appWindow.close()}><X size={15} strokeWidth={2.5} /></button>
</div>

<style>
  .window-controls {
    display: flex;
    gap: 13px;
    margin-inline-start: 6px;
  }

  button {
    display: grid;
    place-items: center;
    width: 24px;
    height: 24px;
    padding: 0;
    border: 0;
    border-radius: 50%;
    background: var(--app-hover);
    color: inherit;
    cursor: pointer;
  }

  button:hover {
    background: var(--app-active);
  }
</style>
