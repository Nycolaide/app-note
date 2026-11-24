<script lang="ts">
  import type { Snippet } from "svelte";
  import WindowControls from "./WindowControls.svelte";

  interface Props {
    title?: string;
    subtitle?: string;
    controls?: boolean;
    flat?: boolean;
    start?: Snippet;
    center?: Snippet;
    end?: Snippet;
  }

  let { title, subtitle, controls = false, flat = false, start, center, end }: Props = $props();
</script>

<header class="header-bar" class:flat data-tauri-drag-region>
  <div class="start" data-tauri-drag-region>{@render start?.()}</div>

  <div class="center" data-tauri-drag-region>
    {#if center}
      {@render center()}
    {:else if title}
      <span class="title" data-tauri-drag-region>{title}</span>
      {#if subtitle}<span class="subtitle" data-tauri-drag-region>{subtitle}</span>{/if}
    {/if}
  </div>

  <div class="end" data-tauri-drag-region>
    {@render end?.()}
    {#if controls}<WindowControls />{/if}
  </div>
</header>

<style>
  .header-bar {
    display: grid;
    flex-shrink: 0;
    grid-template-columns: 1fr minmax(0, auto) 1fr;
    align-items: center;
    gap: 6px;
    min-height: var(--app-header-height);
    padding: 6px;
    box-shadow: inset 0 -1px var(--app-headerbar-shade);
    user-select: none;
  }

  .header-bar.flat {
    box-shadow: none;
  }

  .start,
  .end {
    display: flex;
    align-items: center;
    gap: 6px;
  }

  .end {
    justify-content: flex-end;
  }

  .center {
    display: flex;
    flex-direction: column;
    align-items: center;
    min-width: 0;
    line-height: 1.2;
  }

  .title,
  .subtitle {
    max-width: 100%;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .title {
    font-weight: 700;
  }

  .subtitle {
    font-size: 0.8rem;
    color: var(--app-dim);
  }
</style>
