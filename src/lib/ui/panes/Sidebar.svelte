<script lang="ts">
  import type { VaultDescriptor } from "$lib/core";
  import type { DropdownTriggerProps } from "lapikit/components";
  import { Check, Cloud, CloudAlert, HardDrive, Menu, PanelLeft, RefreshCw, Trash2 } from "@lucide/svelte";
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

  const RING_CIRCUMFERENCE = 2 * Math.PI * 15;

  const currentId = $derived(app.session?.descriptor.id ?? null);
  const overview = $derived(app.syncOverview);
  const selectedFolder = $derived(app.scope.kind === "folder" && !app.searching ? app.scope.path : null);
  const selectedTag = $derived(app.scope.kind === "tag" && !app.searching ? app.scope.tag : null);
  const hideLabel = $derived(drawerLayout.current ? "Fermer les dossiers" : "Masquer la barre latérale");

  const themes: { name: ThemeName; label: string }[] = [
    { name: "system", label: "Suivre le système" },
    { name: "light", label: "Clair" },
    { name: "dark", label: "Sombre" },
  ];

  const syncLabel = $derived.by(() => {
    if (overview.running) return "Synchronisation…";
    if (overview.failures.length > 0) return "Échec de la synchro";
    if (overview.lastSuccess) return `Synchronisé à ${formatTime(overview.lastSuccess)}`;
    return "Pas encore synchronisé";
  });

  const failureDetails = $derived(overview.failures.map(({ name, message }) => `${name} : ${message}`).join("\n"));
  const nextSyncLabel = $derived(app.nextSyncAt ? `Prochaine à ${formatTime(new Date(app.nextSyncAt))}` : "");

  function formatTime(date: Date): string {
    return date.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
  }

  function elapsedSinceLastCycle(nextSyncAt: number): number {
    return Math.min(app.syncIntervalMs, Math.max(0, app.syncIntervalMs - (nextSyncAt - Date.now())));
  }

  function actionsFor(descriptor: VaultDescriptor): FolderActions {
    if (descriptor.id === currentId) return folderActions;
    const inVault =
      (action: (path: string) => void) =>
      async (path: string): Promise<void> => {
        await app.selectVaultFolder(descriptor, "");
        if (app.session?.descriptor.id === descriptor.id) action(path);
      };
    return {
      create: inVault(folderActions.create),
      rename: inVault(folderActions.rename),
      move: inVault(folderActions.move),
      trash: inVault(folderActions.trash),
    };
  }
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
      <span class="brand">
        <img src="/runote.svg" alt="" width="22" height="22" />
        Runote
      </span>
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
          <hr />
          <button type="button" class="row-button" onclick={onabout}>À propos</button>
        </div>
      </kit:dropdown>
    {/snippet}
  </HeaderBar>

  <div class="scroll">
    <ul class="tree" aria-label="Vaults">
      {#each app.vaults as descriptor (descriptor.id)}
        {@const tree = app.trees.get(descriptor.id)}
        {@const failure = app.syncStatuses[descriptor.id]?.lastError}
        {#if tree}
          <FolderTree
            node={tree}
            rootName={descriptor.name}
            selected={descriptor.id === currentId ? selectedFolder : null}
            onselect={(path) => app.selectVaultFolder(descriptor, path)}
            actions={actionsFor(descriptor)}
          >
            {#snippet rootIcon()}
              {#if descriptor.remote}<Cloud size={16} />{:else}<HardDrive size={16} />{/if}
            {/snippet}
            {#snippet rootBadges()}
              {#if descriptor.remote?.kind === "google-drive"}<span class="beta-badge">Bêta</span>{/if}
              {#if failure}
                <span class="vault-alert" title={failure} aria-label="Échec de la synchronisation"><CloudAlert size={14} /></span>
              {/if}
            {/snippet}
            {#snippet rootMenu()}
              {#if descriptor.remote}
                <button type="button" class="row-button destructive" onclick={() => onremovevault(descriptor)}>
                  Retirer « {descriptor.name} »
                </button>
              {/if}
            {/snippet}
          </FolderTree>
        {/if}
      {/each}
    </ul>

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

  {#if app.topTags.length > 0}
    <section class="tags" aria-labelledby="tags-title">
      <h2 id="tags-title">Tags</h2>
      <div class="chips">
        {#each app.topTags as { tag, count } (tag)}
          <button
            type="button"
            class="chip"
            aria-current={selectedTag === tag ? "page" : undefined}
            onclick={() => app.showTag(tag)}
          >
            #{tag}
            <span class="chip-count">{count}</span>
          </button>
        {/each}
      </div>
    </section>
  {/if}

  {#if app.hasRemoteVaults}
    <footer class:failed={overview.failures.length > 0}>
      <div class="sync-text">
        <span class="sync-label" title={failureDetails || undefined}>{syncLabel}</span>
        {#if overview.conflicts > 0}
          <span class="sync-detail">{overview.conflicts} conflit{overview.conflicts > 1 ? "s" : ""} : une copie a été créée à côté de la note.</span>
        {:else if nextSyncLabel}
          <span class="sync-detail">{nextSyncLabel}</span>
        {/if}
      </div>
      <button
        type="button"
        class="sync-timer"
        aria-label="Synchroniser maintenant"
        title="Synchroniser maintenant"
        disabled={overview.running}
        onclick={() => app.syncNow()}
      >
        <svg viewBox="0 0 36 36" aria-hidden="true">
          <circle class="track" cx="18" cy="18" r="15" />
          {#if app.nextSyncAt && !overview.running}
            {#key app.nextSyncAt}
              <circle
                class="progress"
                cx="18"
                cy="18"
                r="15"
                stroke-dasharray={RING_CIRCUMFERENCE}
                style:--ring-circumference={RING_CIRCUMFERENCE}
                style:animation-duration="{app.syncIntervalMs}ms"
                style:animation-delay="-{elapsedSinceLastCycle(app.nextSyncAt)}ms"
              />
            {/key}
          {/if}
        </svg>
        <span class="spin" class:running={overview.running}><RefreshCw size={14} /></span>
      </button>
    </footer>
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

  .brand {
    display: flex;
    align-items: center;
    gap: 8px;
    font-weight: 700;
  }

  .vault-alert {
    display: grid;
    color: var(--app-destructive-text);
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

  .tags {
    padding: 6px 12px 10px;
    border-top: 1px solid var(--app-border);
  }

  h2 {
    margin: 0 0 8px;
    font-size: 0.8rem;
    font-weight: 700;
    color: var(--app-dim);
  }

  .chips {
    display: flex;
    flex-wrap: wrap;
    gap: 6px;
  }

  .chip {
    display: flex;
    align-items: center;
    gap: 6px;
    max-width: 100%;
    min-height: 28px;
    padding: 0 10px;
    overflow: hidden;
    border: 0;
    border-radius: 999px;
    background: var(--app-hover);
    color: inherit;
    font: inherit;
    font-size: 0.85rem;
    white-space: nowrap;
    text-overflow: ellipsis;
    cursor: pointer;
  }

  .chip:hover {
    background: var(--app-active);
  }

  .chip[aria-current="page"] {
    background: var(--app-accent);
    color: var(--app-accent-fg);
  }

  .chip-count {
    font-size: 0.75rem;
    opacity: 0.7;
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
    gap: 8px;
    padding: 8px 8px 8px 12px;
    border-top: 1px solid var(--app-border);
    color: var(--app-dim);
  }

  footer.failed .sync-label {
    color: var(--app-destructive-text);
  }

  .sync-text {
    display: flex;
    flex: 1;
    flex-direction: column;
    min-width: 0;
  }

  .sync-label {
    font-size: 0.85rem;
    font-weight: 600;
  }

  .sync-detail {
    font-size: 0.75rem;
  }

  .sync-timer {
    position: relative;
    display: grid;
    flex-shrink: 0;
    place-items: center;
    width: 34px;
    height: 34px;
    padding: 0;
    border: 0;
    border-radius: 50%;
    background: transparent;
    color: var(--app-fg);
    cursor: pointer;
  }

  .sync-timer:hover:not(:disabled) {
    background: var(--app-hover);
  }

  .sync-timer:disabled {
    cursor: default;
  }

  .sync-timer svg {
    position: absolute;
    inset: 0;
    transform: rotate(-90deg);
  }

  .sync-timer circle {
    fill: none;
    stroke-width: 3;
  }

  .track {
    stroke: var(--app-border);
  }

  .progress {
    stroke: var(--app-accent);
    stroke-linecap: round;
    animation-name: fill-ring;
    animation-timing-function: linear;
    animation-fill-mode: both;
  }

  footer.failed .progress {
    stroke: var(--app-destructive-text);
  }

  @keyframes fill-ring {
    from {
      stroke-dashoffset: var(--ring-circumference);
    }
    to {
      stroke-dashoffset: 0;
    }
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
</style>
