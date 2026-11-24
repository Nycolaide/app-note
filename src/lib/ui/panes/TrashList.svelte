<script lang="ts">
  import { FileText, Folder, RotateCcw, Trash2, X } from "@lucide/svelte";
  import { parentPath } from "$lib/core";
  import HeaderBar from "../HeaderBar.svelte";
  import { folderPathLabel, type NotesApp } from "../notes-app.svelte";
  import { formatUpdated } from "../format";
  import SidebarToggle from "../SidebarToggle.svelte";

  interface Props {
    app: NotesApp;
    controls: boolean;
    onempty: () => void;
  }

  let { app, controls, onempty }: Props = $props();
</script>

<div class="trash-list">
  <HeaderBar title="Corbeille" {controls}>
    {#snippet start()}
      <SidebarToggle />
    {/snippet}
    {#snippet end()}
      {#if app.trash.length > 0}
        <button type="button" class="flat-button destructive" onclick={onempty}>Vider</button>
      {/if}
    {/snippet}
  </HeaderBar>

  {#if app.trash.length === 0}
    <div class="status-page">
      <Trash2 size={64} strokeWidth={1.25} />
      <h2>Corbeille vide</h2>
      <p class="dim">Les éléments supprimés restent ici 30 jours.</p>
    </div>
  {:else}
    <p class="hint dim">Les éléments sont supprimés définitivement après 30 jours.</p>
    <ul class="boxed-list">
      {#each app.trash as entry (entry.id)}
        <li>
          <span class="icon dim">
            {#if entry.kind === "folder"}<Folder size={18} />{:else}<FileText size={18} />{/if}
          </span>
          <span class="details">
            <span class="name">{entry.name}</span>
            <span class="meta dim">
              {folderPathLabel(parentPath(entry.originalPath))}{entry.deletedAt ? ` · ${formatUpdated(entry.deletedAt)}` : ""}
            </span>
          </span>
          <button type="button" class="flat-button" aria-label="Restaurer" title="Restaurer" onclick={() => app.restoreFromTrash(entry.id)}>
            <RotateCcw size={16} />
          </button>
          <button
            type="button"
            class="flat-button destructive"
            aria-label="Supprimer définitivement"
            title="Supprimer définitivement"
            onclick={() => app.deleteFromTrash(entry.id)}
          >
            <X size={16} />
          </button>
        </li>
      {/each}
    </ul>
  {/if}
</div>

<style>
  .trash-list {
    display: flex;
    flex-direction: column;
    height: 100%;
    overflow-y: auto;
    background: var(--app-window-bg);
  }

  .trash-list :global(.header-bar) {
    position: sticky;
    top: 0;
    z-index: 1;
    background: var(--app-headerbar-bg);
  }

  .destructive {
    color: var(--app-destructive-text);
  }

  .hint {
    margin: 12px 18px 6px;
    font-size: 0.85rem;
  }

  .boxed-list {
    margin: 0 12px 12px;
    padding: 0;
    overflow: hidden;
    border-radius: 12px;
    background: var(--app-card-bg);
    box-shadow: 0 0 0 1px var(--app-border);
    list-style: none;
  }

  .boxed-list li {
    display: flex;
    align-items: center;
    gap: 10px;
    min-height: 56px;
    padding: 6px 6px 6px 12px;
  }

  .boxed-list li + li {
    border-top: 1px solid var(--app-border);
  }

  .icon {
    display: grid;
  }

  .details {
    display: flex;
    flex: 1;
    flex-direction: column;
    min-width: 0;
  }

  .name {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .meta {
    font-size: 0.85rem;
  }

  .status-page {
    display: flex;
    flex: 1;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    gap: 6px;
    padding: 24px;
    text-align: center;
    color: var(--app-dim);
  }

  .status-page h2 {
    margin: 12px 0 0;
    font-size: 1.4rem;
    color: var(--app-fg);
  }

  .status-page p {
    margin: 0;
  }
</style>
