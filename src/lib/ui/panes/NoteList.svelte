<script lang="ts">
  import { tick } from "svelte";
  import { Pin, Search, SquarePen, X } from "@lucide/svelte";
  import { parentPath, type NoteMeta } from "$lib/core";
  import HeaderBar from "../HeaderBar.svelte";
  import { folderPathLabel, type NotesApp } from "../notes-app.svelte";
  import { formatUpdated } from "../format";
  import SidebarToggle from "../SidebarToggle.svelte";
  import NoteContextMenu from "./NoteContextMenu.svelte";

  interface Props {
    app: NotesApp;
    controls: boolean;
    onmove: (path: string) => void;
  }

  let { app, controls, onmove }: Props = $props();

  const LONG_PRESS_MS = 500;
  const LONG_PRESS_TOLERANCE = 10;

  let contextMenu = $state<ReturnType<typeof NoteContextMenu>>();
  let longPress: { timer: ReturnType<typeof setTimeout>; x: number; y: number } | null = null;
  let suppressNextClick = false;

  function openContextMenu(event: MouseEvent, meta: NoteMeta): void {
    event.preventDefault();
    cancelLongPress();
    const fromTouch = event instanceof PointerEvent && event.pointerType === "touch";
    contextMenu?.open(meta, event.clientX, event.clientY, !fromTouch);
  }

  function startLongPress(event: PointerEvent, meta: NoteMeta): void {
    suppressNextClick = false;
    if (event.pointerType === "mouse") return;
    cancelLongPress();
    const { clientX: x, clientY: y } = event;
    longPress = {
      x,
      y,
      timer: setTimeout(() => {
        longPress = null;
        suppressNextClick = true;
        navigator.vibrate?.(10);
        contextMenu?.open(meta, x, y, false);
      }, LONG_PRESS_MS),
    };
  }

  function trackLongPress(event: PointerEvent): void {
    if (longPress && Math.hypot(event.clientX - longPress.x, event.clientY - longPress.y) > LONG_PRESS_TOLERANCE) {
      cancelLongPress();
    }
  }

  function cancelLongPress(): void {
    if (longPress) clearTimeout(longPress.timer);
    longPress = null;
  }

  function openNote(path: string): void {
    if (suppressNextClick) {
      suppressNextClick = false;
      return;
    }
    app.openNote(path);
  }
  let searchOpen = $state(false);
  let searchInput = $state<HTMLInputElement>();

  const showFolder = $derived(app.searching || app.scope.kind === "tag");
  const subtitle = $derived(`${app.notes.length} note${app.notes.length > 1 ? "s" : ""}`);
  const searchVisible = $derived(searchOpen || app.searching);
  const pinned = $derived(app.searching ? [] : app.notes.filter((meta) => meta.pinned));
  const others = $derived(app.searching ? app.notes : app.notes.filter((meta) => !meta.pinned));

  async function toggleSearch(): Promise<void> {
    if (searchVisible) {
      closeSearch();
      return;
    }
    searchOpen = true;
    await tick();
    searchInput?.focus();
  }

  function closeSearch(): void {
    searchOpen = false;
    app.query = "";
  }

  function handleSearchKey(event: KeyboardEvent): void {
    if (event.key === "Escape") closeSearch();
  }

  function handleWindowKey(event: KeyboardEvent): void {
    if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "f") {
      event.preventDefault();
      searchOpen = true;
      tick().then(() => searchInput?.focus());
    }
  }
</script>

<svelte:window onkeydown={handleWindowKey} />

<div class="note-list">
  <HeaderBar title={app.searching ? "Recherche" : app.listTitle} {subtitle} {controls}>
    {#snippet start()}
      <SidebarToggle />
      <button type="button" class="flat-button" aria-label="Rechercher" aria-pressed={searchVisible} onclick={toggleSearch}>
        <Search size={16} />
      </button>
    {/snippet}
    {#snippet end()}
      <button type="button" class="flat-button" aria-label="Nouvelle note" onclick={() => app.createNote()}>
        <SquarePen size={16} />
      </button>
    {/snippet}
  </HeaderBar>

  {#if searchVisible}
    <div class="search-bar">
      <label class="search-entry">
        <Search size={16} />
        <input
          bind:this={searchInput}
          type="search"
          placeholder="Rechercher dans toutes les notes"
          bind:value={app.query}
          onkeydown={handleSearchKey}
        />
        {#if app.query}
          <button type="button" class="clear" aria-label="Effacer la recherche" onclick={() => (app.query = "")}>
            <X size={14} />
          </button>
        {/if}
      </label>
    </div>
  {/if}

  {#if app.notes.length === 0}
    <div class="status-page">
      {#if app.searching}
        <Search size={64} strokeWidth={1.25} />
        <h2>Aucun résultat</h2>
        <p class="dim">Aucune note ne contient « {app.query.trim()} ».</p>
      {:else}
        <SquarePen size={64} strokeWidth={1.25} />
        <h2>Aucune note</h2>
        <p class="dim">Ce dossier est vide.</p>
        <kit:btn variant="filled" color="accent" rounded="full" onclick={() => app.createNote()}>Nouvelle note</kit:btn>
      {/if}
    </div>
  {:else}
    <div class="sections">
      {#if pinned.length > 0}
        <section aria-label="Épinglées">
          <h2><Pin size={12} /> Épinglées</h2>
          {@render list(pinned)}
        </section>
        {#if others.length > 0}
          <section aria-label="Notes">
            <h2>Notes</h2>
            {@render list(others)}
          </section>
        {/if}
      {:else}
        {@render list(others)}
      {/if}
    </div>
  {/if}
</div>

<NoteContextMenu
  bind:this={contextMenu}
  onpin={(meta) => app.togglePinned(meta.path)}
  onmove={(meta) => onmove(meta.path)}
  ontrash={(meta) => app.trashNote(meta.path)}
/>

{#snippet list(metas: NoteMeta[])}
  <ul>
    {#each metas as meta (meta.path)}
      <li>
        <button
          type="button"
          class="note"
          aria-current={meta.path === app.selectedNotePath ? "page" : undefined}
          onclick={() => openNote(meta.path)}
          oncontextmenu={(event) => openContextMenu(event, meta)}
          onpointerdown={(event) => startLongPress(event, meta)}
          onpointermove={trackLongPress}
          onpointerup={cancelLongPress}
          onpointercancel={cancelLongPress}
        >
          <span class="title">
            {#if meta.pinned && app.searching}<Pin size={12} aria-label="Épinglée" />{/if}
            <span class="title-text">{meta.title}</span>
          </span>
          <span class="meta">
            <time datetime={meta.updated}>{formatUpdated(meta.updated)}</time>
            <span class="excerpt">{meta.excerpt || "Aucun texte"}</span>
          </span>
          {#if showFolder}
            <span class="folder">{folderPathLabel(parentPath(meta.path))}</span>
          {/if}
        </button>
      </li>
    {/each}
  </ul>
{/snippet}

<style>
  .note-list {
    display: flex;
    flex-direction: column;
    height: 100%;
    background: var(--app-view-bg);
  }

  .note-list :global(.header-bar) {
    background: var(--app-headerbar-bg);
  }

  .search-bar {
    padding: 6px 12px;
    background: var(--app-headerbar-bg);
    box-shadow: inset 0 -1px var(--app-headerbar-shade);
  }

  .search-entry {
    display: flex;
    align-items: center;
    gap: 8px;
    height: 34px;
    padding: 0 9px;
    border-radius: var(--app-radius);
    background: var(--app-hover);
    color: var(--app-dim);
  }

  .search-entry:focus-within {
    outline: 2px solid color-mix(in srgb, var(--app-accent) 50%, transparent);
    outline-offset: -2px;
  }

  .search-entry input {
    flex: 1;
    min-width: 0;
    border: 0;
    outline: none;
    background: transparent;
    color: var(--app-fg);
    font: inherit;
  }

  .search-entry input::-webkit-search-cancel-button {
    appearance: none;
  }

  .clear {
    display: grid;
    place-items: center;
    width: 20px;
    height: 20px;
    padding: 0;
    border: 0;
    border-radius: 50%;
    background: var(--app-hover);
    color: inherit;
    cursor: pointer;
  }

  .sections {
    flex: 1;
    padding: 6px;
    overflow-y: auto;
  }

  section + section {
    margin-top: 12px;
  }

  h2 {
    display: flex;
    align-items: center;
    gap: 6px;
    margin: 0;
    padding: 6px 12px;
    font-size: 0.8rem;
    font-weight: 700;
    color: var(--app-dim);
  }

  ul {
    margin: 0;
    padding: 0;
    list-style: none;
  }

  li + li {
    margin-top: 2px;
  }

  .note {
    display: flex;
    flex-direction: column;
    gap: 2px;
    width: 100%;
    padding: 10px 12px;
    border: 0;
    border-radius: var(--app-radius);
    background: transparent;
    color: inherit;
    text-align: start;
    cursor: pointer;
    user-select: none;
    -webkit-user-select: none;
    -webkit-touch-callout: none;
  }

  .note:hover {
    background: var(--app-hover);
  }

  .note[aria-current="page"] {
    background: var(--app-accent-selected);
  }

  .title {
    display: flex;
    align-items: center;
    gap: 6px;
    min-width: 0;
    font-weight: 700;
  }

  .title-text {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .meta {
    display: flex;
    gap: 8px;
    font-size: 0.9rem;
  }

  time {
    flex-shrink: 0;
  }

  .excerpt {
    overflow: hidden;
    color: var(--app-dim);
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .folder {
    font-size: 0.8rem;
    color: var(--app-dim);
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
    margin: 0 0 12px;
  }
</style>
