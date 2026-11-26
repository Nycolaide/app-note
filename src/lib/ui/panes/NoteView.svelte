<script lang="ts">
  import type { DropdownTriggerProps } from "lapikit/components";
  import { openUrl } from "@tauri-apps/plugin-opener";
  import { ChevronLeft, EllipsisVertical, Pin, PinOff } from "@lucide/svelte";
  import { parentPath, type Note } from "$lib/core";
  import HeaderBar from "../HeaderBar.svelte";
  import MarkdownEditor from "../MarkdownEditor.svelte";
  import { createLinkPreviewCard } from "../link-preview-card";
  import { folderPathLabel, type NotesApp } from "../notes-app.svelte";
  import { formatFull } from "../format";
  import { mobileLayout } from "../viewport";
  import TagsEditor from "./TagsEditor.svelte";

  interface Props {
    app: NotesApp;
    note: Note;
    controls: boolean;
    onmove: (path: string) => void;
  }

  let { app, note, controls, onmove }: Props = $props();

  let title = $state("");
  const savedTitle = $derived(note.title);
  const tagSuggestions = $derived(app.tags.map(({ tag }) => tag));

  $effect.pre(() => {
    title = savedTitle;
  });

  function commitTitle(): void {
    if (title.trim() === "") title = note.title;
    else app.renameNote(title);
  }

  function handleTitleKey(event: KeyboardEvent): void {
    if (event.key === "Enter") {
      event.preventDefault();
      (event.currentTarget as HTMLInputElement).blur();
    } else if (event.key === "Escape") {
      title = note.title;
      (event.currentTarget as HTMLInputElement).blur();
    }
  }
</script>

<article class="note-view">
  <HeaderBar title={note.title} subtitle={folderPathLabel(parentPath(note.path))} {controls}>
    {#snippet start()}
      {#if mobileLayout.current}
        <button type="button" class="flat-button" aria-label="Retour à la liste" onclick={() => app.closeNote()}>
          <ChevronLeft size={18} />
        </button>
      {/if}
    {/snippet}
    {#snippet end()}
      <button
        type="button"
        class="flat-button"
        aria-label={note.pinned ? "Désépingler" : "Épingler"}
        title={note.pinned ? "Désépingler" : "Épingler"}
        aria-pressed={note.pinned}
        onclick={() => app.togglePinned(note.path)}
      >
        {#if note.pinned}<PinOff size={16} />{:else}<Pin size={16} />{/if}
      </button>
      <kit:dropdown closeOnClick elevation="2" position="bottom">
        {#snippet trigger(props: DropdownTriggerProps)}
          <button type="button" class="flat-button" aria-label="Actions de la note" {...props}>
            <EllipsisVertical size={16} />
          </button>
        {/snippet}
        <div class="menu">
          <button type="button" class="row-button" onclick={() => app.togglePinned(note.path)}>
            {note.pinned ? "Désépingler" : "Épingler"}
          </button>
          <button type="button" class="row-button" onclick={() => onmove(note.path)}>Déplacer…</button>
          <button type="button" class="row-button destructive" onclick={() => app.trashNote(note.path)}>Mettre à la corbeille</button>
        </div>
      </kit:dropdown>
    {/snippet}
  </HeaderBar>

  <div class="scroll">
    <div class="page">
      <time class="updated dim" datetime={note.updated}>{formatFull(note.updated)}</time>

      <input
        class="title"
        aria-label="Titre de la note"
        placeholder="Sans titre"
        bind:value={title}
        onblur={commitTitle}
        onkeydown={handleTitleKey}
      />

      <TagsEditor tags={app.draftTags} suggestions={tagSuggestions} onchange={(tags) => app.updateTags(tags)} />

      {#key `${note.path}#${app.editorGeneration}`}
        <MarkdownEditor
          value={app.draftContent}
          onchange={(markdown) => app.updateContent(markdown)}
          resolveImage={(source) => app.resolveImage(source)}
          saveImage={(data, fileName) => app.saveImage(data, fileName)}
          renderLinkPreview={(url) => createLinkPreviewCard(url, app.linkPreviews.get, openUrl)}
        />
      {/key}
    </div>
  </div>
</article>

<style>
  .note-view {
    display: flex;
    flex-direction: column;
    height: 100%;
    background: var(--app-view-bg);
  }

  .note-view :global(.header-bar) {
    background: var(--app-headerbar-bg);
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

  .scroll {
    flex: 1;
    overflow-y: auto;
    overscroll-behavior: contain;
  }

  .page {
    display: flex;
    flex-direction: column;
    gap: 10px;
    padding: 18px 24px 96px;
  }

  .updated {
    align-self: center;
    font-size: 0.8rem;
  }

  .title {
    width: 100%;
    padding: 0;
    border: 0;
    outline: none;
    background: transparent;
    color: var(--app-fg);
    font: inherit;
    font-size: 1.9rem;
    font-weight: 800;
  }

  @media (max-width: 899px) {
    .page {
      padding-inline: 16px;
    }
  }
</style>
