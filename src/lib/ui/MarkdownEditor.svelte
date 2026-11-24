<script lang="ts">
  import { onMount, type Component } from "svelte";
  import {
    Bold,
    Code,
    Heading1,
    Heading2,
    Heading3,
    ImagePlus,
    Italic,
    List,
    ListOrdered,
    ListTodo,
    Minus,
    Pilcrow,
    Quote,
    SquareCode,
    Strikethrough,
    Table,
  } from "@lucide/svelte";
  import { createMarkdownEditor, type FormatCommand, type MarkdownEditor } from "./markdown-editor";
  import type { LinkPreviewRenderer } from "./link-preview-plugin";

  interface Props {
    value: string;
    onchange: (markdown: string) => void;
    resolveImage: (source: string) => Promise<string>;
    saveImage: (data: Uint8Array, fileName: string) => Promise<string>;
    renderLinkPreview: LinkPreviewRenderer;
  }

  interface Tool {
    label: string;
    icon: Component<{ size?: number }>;
    run: () => void;
  }

  let { value, onchange, resolveImage, saveImage, renderLinkPreview }: Props = $props();
  let root: HTMLDivElement;
  let fileInput: HTMLInputElement;
  let editor = $state.raw<MarkdownEditor | undefined>();

  const format = (command: FormatCommand) => () => editor?.format(command);

  const toolGroups: Tool[][] = [
    [
      { label: "Texte", icon: Pilcrow, run: format("paragraph") },
      { label: "Titre", icon: Heading1, run: format("heading1") },
      { label: "Sous-titre", icon: Heading2, run: format("heading2") },
      { label: "Intertitre", icon: Heading3, run: format("heading3") },
    ],
    [
      { label: "Gras", icon: Bold, run: format("bold") },
      { label: "Italique", icon: Italic, run: format("italic") },
      { label: "Barré", icon: Strikethrough, run: format("strike") },
      { label: "Code", icon: Code, run: format("code") },
    ],
    [
      { label: "Liste à puces", icon: List, run: format("bulletList") },
      { label: "Liste numérotée", icon: ListOrdered, run: format("orderedList") },
      { label: "Liste de tâches", icon: ListTodo, run: format("taskList") },
      { label: "Citation", icon: Quote, run: format("quote") },
      { label: "Bloc de code", icon: SquareCode, run: format("codeBlock") },
    ],
    [
      { label: "Tableau", icon: Table, run: () => editor?.insertTable() },
      { label: "Image", icon: ImagePlus, run: () => fileInput.click() },
      { label: "Séparateur", icon: Minus, run: format("rule") },
    ],
  ];

  async function storeImage(file: File): Promise<string> {
    return saveImage(new Uint8Array(await file.arrayBuffer()), file.name);
  }

  async function insertPickedImages(): Promise<void> {
    const files = Array.from(fileInput.files ?? []);
    fileInput.value = "";

    for (const file of files) {
      editor?.insertImage(await storeImage(file), file.name);
    }
  }

  onMount(() => {
    const created = createMarkdownEditor({
      root,
      value,
      onChange: (markdown) => onchange(markdown),
      resolveImage: (source) => resolveImage(source),
      saveImage: storeImage,
      renderLinkPreview: (url) => renderLinkPreview(url),
    });

    created.then((instance) => (editor = instance));

    return () => {
      editor = undefined;
      created.then((instance) => instance.destroy());
    };
  });
</script>

<div class="editor">
  <div class="format-bar" role="toolbar" aria-label="Mise en forme">
    <div class="tools">
      {#each toolGroups as group, index (index)}
        <div class="group">
          {#each group as tool (tool.label)}
            {@const Icon = tool.icon}
            <button
              type="button"
              aria-label={tool.label}
              title={tool.label}
              disabled={!editor}
              onmousedown={(event) => event.preventDefault()}
              onclick={tool.run}
            >
              <Icon size={16} />
            </button>
          {/each}
        </div>
      {/each}
    </div>
  </div>
  <input bind:this={fileInput} type="file" accept="image/*" multiple hidden onchange={insertPickedImages} />

  <div class="content" bind:this={root}></div>
</div>

<style>
  .editor {
    display: flex;
    flex-direction: column;
    gap: 0.75rem;
  }

  .format-bar {
    position: sticky;
    top: 0;
    z-index: 1;
    margin-inline: -6px;
    padding: 4px;
    overflow-x: auto;
    border-radius: 12px;
    background: var(--app-view-bg);
    scrollbar-width: none;
  }

  .tools {
    display: flex;
    gap: 2px;
    width: max-content;
  }

  .group {
    display: flex;
    gap: 2px;
  }

  .group + .group::before {
    content: "";
    align-self: center;
    width: 1px;
    height: 18px;
    margin-inline: 4px;
    background: var(--app-border);
  }

  .format-bar button {
    display: grid;
    place-items: center;
    width: 32px;
    height: 32px;
    border: 0;
    border-radius: var(--app-radius);
    background: transparent;
    color: var(--app-dim);
    cursor: pointer;
  }

  .format-bar button:hover:not(:disabled) {
    background: var(--app-hover);
    color: var(--app-fg);
  }

  .format-bar button:active:not(:disabled) {
    background: var(--app-active);
  }

  .group {
    flex-shrink: 0;
  }

  .format-bar button:disabled {
    opacity: 0.5;
    cursor: default;
  }

  .content :global(.ProseMirror) {
    min-height: 50vh;
    outline: none;
    font-size: 1rem;
    line-height: 1.6;
  }

  .content :global(.ProseMirror > :first-child) {
    margin-top: 0;
  }

  .content :global(h1),
  .content :global(h2),
  .content :global(h3) {
    margin: 1.5rem 0 0.5rem;
    line-height: 1.25;
  }

  .content :global(h1) {
    font-size: 1.5rem;
  }

  .content :global(h2) {
    font-size: 1.25rem;
  }

  .content :global(h3) {
    font-size: 1.0625rem;
  }

  .content :global(p) {
    margin: 0.5rem 0;
  }

  .content :global(li > p),
  .content :global(.task-content > p),
  .content :global(td > p),
  .content :global(th > p) {
    margin: 0;
  }

  .content :global(li) {
    margin: 0.125rem 0;
  }

  .content :global(ul:has(> li[data-item-type="task"])) {
    padding-inline-start: 0.25rem;
  }

  .content :global(li[data-item-type="task"]) {
    display: flex;
    align-items: flex-start;
    gap: 10px;
    margin: 0.25rem 0;
    list-style: none;
  }

  .content :global(.task-checkbox) {
    position: relative;
    flex-shrink: 0;
    width: 20px;
    height: 20px;
    margin-top: 2px;
    border: 2px solid var(--app-dim);
    border-radius: 50%;
    cursor: pointer;
    transition:
      background-color 120ms ease,
      border-color 120ms ease;
  }

  .content :global(.task-checkbox:hover) {
    border-color: var(--app-accent);
  }

  .content :global(.task-checkbox[aria-checked="true"]) {
    border-color: var(--app-accent);
    background: var(--app-accent);
  }

  .content :global(.task-checkbox[aria-checked="true"]::after) {
    content: "";
    position: absolute;
    top: 2px;
    left: 5px;
    width: 5px;
    height: 9px;
    border: solid var(--app-accent-fg);
    border-width: 0 2px 2px 0;
    transform: rotate(45deg);
  }

  .content :global(.task-content) {
    flex: 1;
    min-width: 0;
  }

  .content :global(li[data-checked="true"] > .task-content > p) {
    color: var(--app-dim);
  }

  .content :global(a) {
    color: var(--app-accent-text);
  }

  .content :global(blockquote) {
    margin: 0.75rem 0;
    padding-inline-start: 1rem;
    border-inline-start: 3px solid var(--app-accent);
    color: var(--app-dim);
  }

  .content :global(code) {
    padding: 0.1rem 0.3rem;
    border-radius: 4px;
    background: var(--app-hover);
    font-size: 0.9em;
  }

  .content :global(pre) {
    padding: 0.75rem 1rem;
    overflow-x: auto;
    border-radius: 12px;
    background: var(--app-card-bg);
  }

  .content :global(pre code) {
    padding: 0;
    background: transparent;
  }

  .content :global(hr) {
    margin: 1.5rem 0;
    border: 0;
    border-top: 1px solid var(--app-border);
  }

  .content :global(img) {
    max-width: 100%;
    border-radius: 12px;
  }

  .content :global(table) {
    width: 100%;
    margin: 0.75rem 0;
    border-collapse: collapse;
  }

  .content :global(th),
  .content :global(td) {
    padding: 0.375rem 0.625rem;
    border: 1px solid var(--app-border);
    text-align: start;
    vertical-align: top;
  }

  .content :global(th) {
    background: var(--app-card-bg);
    font-weight: 600;
  }

  .content :global(.link-preview) {
    display: grid;
    grid-template-columns: 1fr auto;
    gap: 0.125rem 1rem;
    max-width: 34rem;
    margin: 0.25rem 0 0.75rem;
    padding: 0.75rem;
    border: 1px solid var(--app-border);
    border-radius: 12px;
    background: var(--app-card-bg);
    font-size: 0.9rem;
    color: var(--app-dim);
    cursor: pointer;
  }

  .content :global(.link-preview:hover) {
    background: var(--app-hover);
  }

  .content :global(.link-preview img) {
    grid-row: 1 / span 3;
    grid-column: 2;
    width: 6rem;
    height: 4.5rem;
    object-fit: cover;
    border-radius: var(--app-radius);
  }

  .content :global(.link-preview strong) {
    color: var(--app-fg);
  }

  .content :global(.link-preview p) {
    display: -webkit-box;
    margin: 0;
    overflow: hidden;
    -webkit-line-clamp: 2;
    line-clamp: 2;
    -webkit-box-orient: vertical;
  }
</style>
