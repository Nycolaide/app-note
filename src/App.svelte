<script lang="ts">
  import { onMount } from "svelte";
  import TitleBar from "$lib/ui/TitleBar.svelte";
  import MarkdownEditor from "$lib/ui/MarkdownEditor.svelte";
  import { createAttachmentUrls, type AttachmentUrls } from "$lib/ui/attachment-urls";
  import { createLinkPreviewCard } from "$lib/ui/link-preview-card";
  import { openUrl } from "@tauri-apps/plugin-opener";
  import { createLinkPreviews, openLocalVault, parentPath, type FolderNode, type NoteMeta, type Vault } from "$lib/core";

  const SAVE_DELAY_MS = 500;
  const linkPreviews = createLinkPreviews();

  let vault = $state.raw<Vault | null>(null);
  let attachments: AttachmentUrls | undefined;
  let version = $state(0);
  let error = $state("");

  let selectedFolder = $state("");
  let selectedNotePath = $state<string | null>(null);
  let activeTag = $state<string | null>(null);
  let query = $state("");
  let showTrash = $state(false);
  let confirmingEmpty = $state(false);

  let newFolderName = $state("");
  let folderName = $state("");
  let folderTarget = $state("");
  let noteTarget = $state("");

  let draftTitle = $state("");
  let draftContent = $state("");
  let draftTags = $state("");
  let saveTimer: ReturnType<typeof setTimeout> | undefined;

  const tree = $derived(track((v) => v.tree(), undefined));
  const folders = $derived(track((v) => v.folders(), []));
  const tags = $derived(track((v) => v.tags(), []));
  const trashEntries = $derived(track((v) => v.trash(), []));
  const note = $derived(track((v) => (selectedNotePath ? v.getNote(selectedNotePath) : undefined), undefined));

  const visibleNotes = $derived(
    track((v): NoteMeta[] => {
      if (query.trim()) return v.search(query);
      if (activeTag) return v.notesWithTag(activeTag);
      return v.notesIn(selectedFolder);
    }, []),
  );

  const listTitle = $derived(
    query.trim() ? `Recherche : ${query}` : activeTag ? `#${activeTag}` : label(selectedFolder),
  );

  onMount(() => {
    let unsubscribe: (() => void) | undefined;

    attempt(async () => {
      const opened = await openLocalVault();
      unsubscribe = opened.onChange(() => version++);
      attachments = createAttachmentUrls(opened);
      vault = opened;
    });

    return () => {
      unsubscribe?.();
      attachments?.dispose();
    };
  });

  function track<T>(read: (vault: Vault) => T, fallback: T): T {
    version;
    return vault ? read(vault) : fallback;
  }

  function label(path: string): string {
    return path === "" ? "Notes" : path;
  }

  async function attempt(action: () => Promise<unknown>): Promise<void> {
    error = "";
    try {
      await action();
    } catch (cause) {
      error = cause instanceof Error ? cause.message : String(cause);
    }
  }

  function selectFolder(path: string): void {
    selectedFolder = path;
    folderName = path === "" ? "" : path.split("/").at(-1)!;
    folderTarget = "";
    activeTag = null;
    query = "";
    showTrash = false;
  }

  function selectTag(tag: string): void {
    activeTag = tag;
    query = "";
    showTrash = false;
  }

  function openTrash(): void {
    showTrash = true;
    confirmingEmpty = false;
    activeTag = null;
    query = "";
  }

  async function openNote(path: string): Promise<void> {
    await flushSave();
    const opened = vault?.getNote(path);
    if (!opened) return;
    selectedNotePath = path;
    draftTitle = opened.title;
    draftContent = opened.content;
    draftTags = opened.tags.join(", ");
    noteTarget = "";
  }

  function updateContent(markdown: string): void {
    draftContent = markdown;
    scheduleSave();
  }

  function scheduleSave(): void {
    clearTimeout(saveTimer);
    saveTimer = setTimeout(flushSave, SAVE_DELAY_MS);
  }

  async function flushSave(): Promise<void> {
    clearTimeout(saveTimer);
    saveTimer = undefined;
    if (!vault || !note) return;
    const target = vault;
    const path = note.path;
    const changes = { content: draftContent, tags: draftTags.split(",") };
    await attempt(() => target.saveNote(path, changes));
  }

  function createFolder(event: SubmitEvent): void {
    event.preventDefault();
    attempt(async () => {
      const path = await vault!.createFolder(selectedFolder, newFolderName);
      newFolderName = "";
      selectFolder(path);
    });
  }

  function renameFolder(): void {
    attempt(async () => selectFolder(await vault!.renameFolder(selectedFolder, folderName)));
  }

  function moveFolder(): void {
    attempt(async () => selectFolder(await vault!.moveFolder(selectedFolder, folderTarget)));
  }

  function trashFolder(): void {
    attempt(async () => {
      const deleted = selectedFolder;
      await vault!.trashFolder(deleted);
      if (selectedNotePath?.startsWith(`${deleted}/`)) selectedNotePath = null;
      selectFolder("");
    });
  }

  function emptyTrash(): void {
    confirmingEmpty = false;
    attempt(() => vault!.emptyTrash());
  }

  function createNote(): void {
    attempt(async () => {
      const created = await vault!.createNote(selectedFolder);
      await openNote(created.path);
    });
  }

  function renameNote(): void {
    if (!note || draftTitle === note.title) return;
    const path = note.path;
    const title = draftTitle;
    attempt(async () => {
      await flushSave();
      const renamed = await vault!.renameNote(path, title);
      await openNote(renamed.path);
    });
  }

  function moveNote(): void {
    if (!note) return;
    const path = note.path;
    const target = noteTarget;
    attempt(async () => {
      await flushSave();
      const moved = await vault!.moveNote(path, target);
      await openNote(moved.path);
    });
  }

  function trashNote(): void {
    if (!note) return;
    const path = note.path;
    attempt(async () => {
      clearTimeout(saveTimer);
      await vault!.trashNote(path);
      selectedNotePath = null;
    });
  }
</script>

<TitleBar />

{#if error}
  <p role="alert">Erreur : {error} <button onclick={() => (error = "")}>OK</button></p>
{/if}

{#if !vault}
  <p>Chargement…</p>
{:else}
  <div class="layout">
    <aside>
      <input type="search" placeholder="Rechercher" bind:value={query} />

      <h2>Dossiers</h2>
      {#if tree}
        <ul>{@render folderItem(tree)}</ul>
      {/if}

      <form onsubmit={createFolder}>
        <input placeholder="Nouveau dossier" bind:value={newFolderName} required />
        <button>Créer dans « {label(selectedFolder)} »</button>
      </form>

      {#if selectedFolder !== ""}
        <fieldset>
          <legend>Dossier « {label(selectedFolder)} »</legend>
          <input bind:value={folderName} />
          <button onclick={renameFolder}>Renommer</button>
          <br />
          <select bind:value={folderTarget}>
            {#each folders as path (path)}
              <option value={path}>{label(path)}</option>
            {/each}
          </select>
          <button onclick={moveFolder}>Déplacer</button>
          <br />
          <button onclick={trashFolder}>Mettre à la corbeille (avec son contenu)</button>
        </fieldset>
      {/if}

      <h2>Tags</h2>
      <ul>
        {#each tags as { tag, count } (tag)}
          <li>
            <button onclick={() => selectTag(tag)}>
              {activeTag === tag ? "▶ " : ""}#{tag} ({count})
            </button>
          </li>
        {:else}
          <li>Aucun tag</li>
        {/each}
      </ul>

      <button onclick={openTrash}>{showTrash ? "▶ " : ""}Corbeille ({trashEntries.length})</button>
    </aside>

    <section>
      {#if showTrash}
        <h2>Corbeille</h2>
        {#if trashEntries.length > 0}
          {#if confirmingEmpty}
            Tout supprimer définitivement ?
            <button onclick={emptyTrash}>Oui, vider</button>
            <button onclick={() => (confirmingEmpty = false)}>Annuler</button>
          {:else}
            <button onclick={() => (confirmingEmpty = true)}>Vider la corbeille</button>
          {/if}
        {/if}
        <ul>
          {#each trashEntries as entry (entry.id)}
            <li>
              {entry.kind === "folder" ? "📁" : "📄"} {entry.name}
              <small>depuis « {label(parentPath(entry.originalPath))} »{entry.deletedAt ? `, supprimé ${new Date(entry.deletedAt).toLocaleString()}` : ""}</small>
              <button onclick={() => attempt(() => vault!.restoreFromTrash(entry.id))}>Restaurer</button>
              <button onclick={() => attempt(() => vault!.deleteFromTrash(entry.id))}>Supprimer définitivement</button>
            </li>
          {:else}
            <li>La corbeille est vide</li>
          {/each}
        </ul>
      {:else}
      <h2>{listTitle}</h2>
      <button onclick={createNote}>Nouvelle note dans « {label(selectedFolder)} »</button>
      <ul>
        {#each visibleNotes as meta (meta.path)}
          <li>
            <button onclick={() => openNote(meta.path)}>
              {meta.path === selectedNotePath ? "▶ " : ""}{meta.title}
            </button>
            <small>{new Date(meta.updated).toLocaleString()}</small>
          </li>
        {:else}
          <li>Aucune note</li>
        {/each}
      </ul>
      {/if}
    </section>

    <article>
      {#if note}
        <input bind:value={draftTitle} onchange={renameNote} />
        <p><small>{note.path} — modifiée {new Date(note.updated).toLocaleString()}</small></p>
        <label>
          Tags (séparés par des virgules)
          <input bind:value={draftTags} oninput={scheduleSave} onchange={flushSave} />
        </label>
        {#key note.path}
          <MarkdownEditor
            value={note.content}
            onchange={updateContent}
            resolveImage={(source) => attachments?.resolve(source) ?? Promise.resolve("")}
            saveImage={(data, fileName) => vault!.saveAttachment(data, fileName)}
            renderLinkPreview={(url) => createLinkPreviewCard(url, linkPreviews.get, openUrl)}
          />
        {/key}
        <select bind:value={noteTarget}>
          {#each folders as path (path)}
            <option value={path}>{label(path)}</option>
          {/each}
        </select>
        <button onclick={moveNote}>Déplacer</button>
        <button onclick={trashNote}>Mettre à la corbeille</button>
      {:else}
        <p>Aucune note sélectionnée</p>
      {/if}
    </article>
  </div>
{/if}

{#snippet folderItem(node: FolderNode)}
  <li>
    <button onclick={() => selectFolder(node.path)}>
      {node.path === selectedFolder && !activeTag && !query && !showTrash ? "▶ " : ""}{node.path === "" ? "Notes" : node.name}
      ({node.noteCount})
    </button>
    {#if node.folders.length > 0}
      <ul>
        {#each node.folders as child (child.path)}
          {@render folderItem(child)}
        {/each}
      </ul>
    {/if}
  </li>
{/snippet}

<style>
  .layout {
    display: grid;
    grid-template-columns: 1fr 1fr 2fr;
    gap: 1rem;
  }
</style>
