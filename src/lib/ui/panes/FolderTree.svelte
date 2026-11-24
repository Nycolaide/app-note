<script lang="ts">
  import type { FolderNode } from "$lib/core";
  import type { DropdownTriggerProps } from "lapikit/components";
  import { ChevronRight, Ellipsis, Folder, NotebookText } from "@lucide/svelte";
  import FolderTree from "./FolderTree.svelte";
  import type { FolderActions } from "./types";

  interface Props {
    node: FolderNode;
    selected: string | null;
    depth?: number;
    onselect: (path: string) => void;
    actions: FolderActions;
  }

  let { node, selected, depth = 0, onselect, actions }: Props = $props();
  let expanded = $state(true);

  const isRoot = $derived(node.path === "");
  const hasChildren = $derived(node.folders.length > 0);
  const active = $derived(selected === node.path);
</script>

<li>
  <div class="row" class:active style:--depth={depth}>
    <button type="button" class="label" aria-current={active ? "page" : undefined} onclick={() => onselect(node.path)}>
      {#if isRoot}<NotebookText size={16} />{:else}<Folder size={16} />{/if}
      <span class="name">{isRoot ? "Notes" : node.name}</span>
    </button>

    <span class="count dim">{node.noteCount}</span>

    <kit:dropdown closeOnClick elevation="2" position="bottom">
      {#snippet trigger(props: DropdownTriggerProps)}
        <button type="button" class="icon more" aria-label="Actions du dossier" {...props}><Ellipsis size={16} /></button>
      {/snippet}
      <div class="menu">
        <button type="button" class="row-button" onclick={() => actions.create(node.path)}>Nouveau sous-dossier</button>
        {#if !isRoot}
          <button type="button" class="row-button" onclick={() => actions.rename(node.path)}>Renommer…</button>
          <button type="button" class="row-button" onclick={() => actions.move(node.path)}>Déplacer…</button>
          <button type="button" class="row-button destructive" onclick={() => actions.trash(node.path)}>Mettre à la corbeille</button>
        {/if}
      </div>
    </kit:dropdown>

    {#if hasChildren}
      <button
        type="button"
        class="icon toggle"
        class:expanded
        aria-label={expanded ? "Replier" : "Déplier"}
        aria-expanded={expanded}
        onclick={() => (expanded = !expanded)}
      >
        <ChevronRight size={14} />
      </button>
    {:else}
      <span class="icon"></span>
    {/if}
  </div>

  {#if hasChildren && expanded}
    <ul>
      {#each node.folders as child (child.path)}
        <FolderTree node={child} {selected} depth={depth + 1} {onselect} {actions} />
      {/each}
    </ul>
  {/if}
</li>

<style>
  ul {
    margin: 0;
    padding: 0;
    list-style: none;
  }

  .row {
    display: flex;
    align-items: center;
    min-height: 36px;
    padding-inline: calc(var(--depth) * 18px) 4px;
    border-radius: var(--app-radius);
  }

  .row:hover {
    background: var(--app-hover);
  }

  .row.active {
    background: var(--app-selected);
  }

  .row button {
    border: 0;
    background: transparent;
    color: inherit;
    cursor: pointer;
  }

  .label {
    display: flex;
    flex: 1;
    align-items: center;
    gap: 10px;
    min-width: 0;
    height: 36px;
    padding: 0 0 0 10px;
    text-align: start;
  }

  .active .label {
    font-weight: 600;
  }

  .name {
    flex: 1;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .count {
    padding-inline: 4px;
    font-size: 0.85rem;
  }

  .icon {
    display: grid;
    flex-shrink: 0;
    place-items: center;
    width: 24px;
    height: 24px;
    padding: 0;
    border-radius: var(--app-radius);
    color: var(--app-dim);
  }

  .icon:hover {
    background: var(--app-hover);
    color: inherit;
  }

  .toggle {
    transition: transform 150ms;
  }

  .toggle.expanded {
    transform: rotate(90deg);
  }

  .more {
    display: none;
  }

  .row:hover .more,
  .row:focus-within .more,
  .more[aria-expanded="true"] {
    display: grid;
  }

  .row:hover .count,
  .row:focus-within .count {
    display: none;
  }

  @media (hover: none) {
    .more {
      display: grid;
    }

    .count {
      display: none;
    }
  }

  .menu {
    display: flex;
    flex-direction: column;
    min-width: 12rem;
    padding: 6px;
  }

  .destructive {
    color: var(--app-destructive-text);
  }
</style>
