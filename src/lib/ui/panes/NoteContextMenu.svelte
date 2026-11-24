<script lang="ts">
  import { tick } from "svelte";
  import { FolderInput, Pin, PinOff, Trash2 } from "@lucide/svelte";
  import type { NoteMeta } from "$lib/core";

  interface Props {
    onpin: (meta: NoteMeta) => void;
    onmove: (meta: NoteMeta) => void;
    ontrash: (meta: NoteMeta) => void;
  }

  let { onpin, onmove, ontrash }: Props = $props();

  const VIEWPORT_MARGIN = 8;

  let menu = $state<HTMLDivElement>();
  let target = $state.raw<NoteMeta | null>(null);
  let position = $state({ x: 0, y: 0 });
  let isOpen = $state(false);

  $effect(() => {
    if (!isOpen) return;
    const closeOnOutsidePointer = (event: PointerEvent) => {
      if (!menu?.contains(event.target as Node)) close();
    };
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") close();
    };
    document.addEventListener("pointerdown", closeOnOutsidePointer, true);
    document.addEventListener("keydown", closeOnEscape);
    document.addEventListener("scroll", close, true);
    window.addEventListener("blur", close);
    window.addEventListener("resize", close);
    return () => {
      document.removeEventListener("pointerdown", closeOnOutsidePointer, true);
      document.removeEventListener("keydown", closeOnEscape);
      document.removeEventListener("scroll", close, true);
      window.removeEventListener("blur", close);
      window.removeEventListener("resize", close);
    };
  });

  function close(): void {
    if (menu?.matches(":popover-open")) menu.hidePopover();
    isOpen = false;
  }

  export async function open(meta: NoteMeta, x: number, y: number, focusFirstItem: boolean): Promise<void> {
    target = meta;
    position = { x, y };
    await tick();
    if (!menu) return;
    if (!menu.matches(":popover-open")) menu.showPopover();
    isOpen = true;
    const { width, height } = menu.getBoundingClientRect();
    position = {
      x: Math.max(VIEWPORT_MARGIN, Math.min(x, innerWidth - width - VIEWPORT_MARGIN)),
      y: Math.max(VIEWPORT_MARGIN, Math.min(y, innerHeight - height - VIEWPORT_MARGIN)),
    };
    if (focusFirstItem) menu.querySelector("button")?.focus();
  }

  function run(action: (meta: NoteMeta) => void): void {
    const meta = target;
    close();
    if (meta) action(meta);
  }
</script>

<div
  bind:this={menu}
  class="context-menu"
  popover="manual"
  role="menu"
  aria-label={target ? `Actions pour « ${target.title} »` : "Actions"}
  style:left="{position.x}px"
  style:top="{position.y}px"
>
  {#if target}
    <button type="button" class="row-button" role="menuitem" onclick={() => run(onpin)}>
      {#if target.pinned}<PinOff size={16} /> Désépingler{:else}<Pin size={16} /> Épingler{/if}
    </button>
    <button type="button" class="row-button" role="menuitem" onclick={() => run(onmove)}>
      <FolderInput size={16} /> Déplacer…
    </button>
    <hr />
    <button type="button" class="row-button destructive" role="menuitem" onclick={() => run(ontrash)}>
      <Trash2 size={16} /> Mettre à la corbeille
    </button>
  {/if}
</div>

<style>
  .context-menu {
    position: fixed;
    inset: auto;
    min-width: 13rem;
    margin: 0;
    padding: 6px;
    border: 0;
    border-radius: 12px;
    background: var(--app-popover-bg);
    color: var(--app-fg);
    box-shadow:
      0 0 0 1px var(--app-border),
      0 4px 16px var(--app-shadow);
  }

  hr {
    margin: 6px 0;
    border: 0;
    border-top: 1px solid var(--app-border);
  }

  .destructive {
    color: var(--app-destructive-text);
  }
</style>
