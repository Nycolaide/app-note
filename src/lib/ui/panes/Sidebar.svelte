<script lang="ts">
  import type { VaultDescriptor } from "$lib/core";
  import type { DropdownTriggerProps } from "lapikit/components";
  import { Check, ChevronDown, Cloud, CloudAlert, HardDrive, Hash, Menu, PanelLeft, RefreshCw, Trash2 } from "@lucide/svelte";
  import { sidebar } from "../layout.svelte";
  import { drawerLayout } from "../viewport";
  import HeaderBar from "../HeaderBar.svelte";
  import type { NotesApp } from "../notes-app.svelte";
  import FolderTree from "./FolderTree.svelte";
  import type { FolderActions, ThemeName } from "./types";

  interface Props {
    app: NotesApp;
    theme: ThemeName;
    folderActions: FolderActions;
    onconnect: () => void;
    onabout: () => void;
    onremovevault: (descriptor: VaultDescriptor) => void;
    ontheme: (theme: ThemeName) => void;
  }

  let { app, theme, folderActions, onconnect, onabout, onremovevault, ontheme }: Props = $props();

  const current = $derived(app.session?.descriptor ?? null);
  const status = $derived(app.syncStatus);
  const selectedFolder = $derived(app.scope.kind === "folder" && !app.searching ? app.scope.path : null);
  const selectedTag = $derived(app.scope.kind === "tag" && !app.searching ? app.scope.tag : null);
  const hideLabel = $derived(drawerLayout.current ? "Fermer les dossiers" : "Masquer la barre latérale");
  const conflicts = $derived(status?.lastReport?.conflicts.length ?? 0);

  const themes: { name: ThemeName; label: string }[] = [
    { name: "system", label: "Suivre le système" },
    { name: "light", label: "Clair" },
    { name: "dark", label: "Sombre" },
  ];

  const syncLabel = $derived.by(() => {
    if (!status) return "";
    if (status.running) return "Synchronisation…";
    if (status.lastError) return "Échec de la synchronisation";
    if (status.lastSuccess) {
      return `Synchronisé à ${status.lastSuccess.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}`;
    }
    return "Pas encore synchronisé";
  });
</script>

<nav class="sidebar" aria-label="Navigation">
  <HeaderBar>
    {#snippet start()}
      <button
        type="button"
        class="flat-button"
        aria-label={hideLabel}
        title="{hideLabel} (F9)"
        onclick={() => sidebar.toggle()}
      >
        <PanelLeft size={16} />
      </button>
    {/snippet}

    {#snippet center()}
      <kit:dropdown closeOnClick elevation="2" position="bottom">
        {#snippet trigger(props: DropdownTriggerProps)}
          <button type="button" class="flat-button vault-switch" {...props}>
            <span class="vault-name">{current?.name ?? "…"}</span>
            <ChevronDown size={14} />
          </button>
        {/snippet}
        <div class="menu">
          {#each app.vaults as descriptor (descriptor.id)}
            <button
              type="button"
              class="row-button"
              aria-current={descriptor.id === current?.id ? "page" : undefined}
              onclick={() => app.attempt(() => app.openVault(descriptor))}
            >
              {#if descriptor.remote}<Cloud size={16} />{:else}<HardDrive size={16} />{/if}
              <span class="grow">{descriptor.name}</span>
              {#if descriptor.remote?.kind === "google-drive"}<span class="beta-badge">Bêta</span>{/if}
              {#if descriptor.id === current?.id}<Check size={16} />{/if}
            </button>
          {/each}
        </div>
      </kit:dropdown>
    {/snippet}

    {#snippet end()}
      <kit:dropdown closeOnClick elevation="2" position="bottom">
        {#snippet trigger(props: DropdownTriggerProps)}
          <button type="button" class="flat-button" aria-label="Menu principal" {...props}><Menu size={16} /></button>
        {/snippet}
        <div class="menu">
          <div class="theme-switcher" role="radiogroup" aria-label="Apparence">
            {#each themes as option (option.name)}
              <button
                type="button"
                class="theme-option {option.name}"
                role="radio"
                aria-checked={theme === option.name}
                aria-label={option.label}
                title={option.label}
                onclick={() => ontheme(option.name)}
              >
                {#if theme === option.name}<Check size={14} strokeWidth={3} />{/if}
              </button>
            {/each}
          </div>
          <hr />
          <button type="button" class="row-button" onclick={() => folderActions.create(app.currentFolder)}>Nouveau dossier</button>
          <button type="button" class="row-button" onclick={onconnect}>Ajouter un vault…</button>
          {#if current?.remote}
            <button type="button" class="row-button destructive" onclick={() => onremovevault(current)}>
              Retirer « {current.name} »
            </button>
          {/if}
          <hr />
          <button type="button" class="row-button" onclick={onabout}>À propos</button>
        </div>
      </kit:dropdown>
    {/snippet}
  </HeaderBar>

  <div class="scroll">
    {#if app.tree}
      <ul class="tree">
        <FolderTree node={app.tree} selected={selectedFolder} onselect={(path) => app.showFolder(path)} actions={folderActions} />
      </ul>
    {/if}

    {#if app.tags.length > 0}
      <h2>Tags</h2>
      <ul>
        {#each app.tags as { tag, count } (tag)}
          <li>
            <button
              type="button"
              class="row-button"
              aria-current={selectedTag === tag ? "page" : undefined}
              onclick={() => app.showTag(tag)}
            >
              <Hash size={16} />
              <span class="grow">{tag}</span>
              <span class="dim count">{count}</span>
            </button>
          </li>
        {/each}
      </ul>
    {/if}

    <hr />
    <button
      type="button"
      class="row-button"
      aria-current={app.scope.kind === "trash" ? "page" : undefined}
      onclick={() => app.showTrash()}
    >
      <Trash2 size={16} />
      <span class="grow">Corbeille</span>
      {#if app.trash.length > 0}<span class="dim count">{app.trash.length}</span>{/if}
    </button>
  </div>

  {#if status}
    <footer class:failed={status.lastError}>
      {#if status.lastError}<CloudAlert size={16} />{/if}
      <span class="grow" title={status.lastError ?? undefined}>{syncLabel}</span>
      <button type="button" class="flat-button" aria-label="Synchroniser maintenant" disabled={status.running} onclick={() => app.syncNow()}>
        <span class="spin" class:running={status.running}><RefreshCw size={16} /></span>
      </button>
    </footer>
    {#if conflicts > 0}
      <p class="conflicts">{conflicts} conflit{conflicts > 1 ? "s" : ""} : une copie a été créée à côté de la note.</p>
    {/if}
  {/if}
</nav>

<style>
  .sidebar {
    display: flex;
    flex-direction: column;
    height: 100%;
    background: var(--app-sidebar-bg);
  }

  .sidebar :global(.header-bar) {
    box-shadow: none;
  }

  .vault-switch {
    display: flex;
    gap: 6px;
    max-width: 100%;
    font-weight: 700;
  }

  .vault-name {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .menu {
    display: flex;
    flex-direction: column;
    min-width: 14rem;
    padding: 6px;
  }

  .menu hr,
  .scroll hr {
    width: 100%;
    margin: 6px 0;
    border: 0;
    border-top: 1px solid var(--app-border);
  }

  .destructive {
    color: var(--app-destructive-text);
  }

  .theme-switcher {
    display: flex;
    justify-content: space-evenly;
    padding: 6px 0;
  }

  .theme-option {
    display: grid;
    place-items: center;
    width: 44px;
    height: 44px;
    border: 1px solid var(--app-border);
    border-radius: 50%;
    cursor: pointer;
  }

  .theme-option[aria-checked="true"] {
    outline: 2px solid var(--app-accent);
    outline-offset: 1px;
  }

  .theme-option.system {
    background: linear-gradient(-45deg, #222226 49.5%, #ffffff 50.5%);
    color: var(--app-accent);
  }

  .theme-option.light {
    background: #ffffff;
    color: #222226;
  }

  .theme-option.dark {
    background: #222226;
    color: #ffffff;
  }

  .scroll {
    flex: 1;
    overflow-y: auto;
    padding: 0 6px 6px;
  }

  ul {
    margin: 0;
    padding: 0;
    list-style: none;
  }

  ul + h2,
  .tree + h2 {
    margin-top: 12px;
  }

  h2 {
    margin: 0;
    padding: 6px 12px;
    font-size: 0.8rem;
    font-weight: 700;
    color: var(--app-dim);
  }

  .grow {
    flex: 1;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .count {
    font-size: 0.85rem;
  }

  footer {
    display: flex;
    align-items: center;
    gap: 6px;
    padding: 6px 6px 6px 12px;
    font-size: 0.85rem;
    color: var(--app-dim);
  }

  footer.failed {
    color: var(--app-destructive-text);
  }

  .spin {
    display: grid;
  }

  .spin.running {
    animation: spin 1s linear infinite;
  }

  @keyframes spin {
    to {
      transform: rotate(360deg);
    }
  }

  .conflicts {
    margin: 0 12px 8px;
    font-size: 0.8rem;
    color: var(--app-dim);
  }
</style>
