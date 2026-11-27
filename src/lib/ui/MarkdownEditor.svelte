<script lang="ts">
  import "prosemirror-view/style/prosemirror.css";
  import { onMount, type Component } from "svelte";
  import {
    Bold,
    CaseSensitive,
    Code,
    Heading1,
    Heading2,
    Heading3,
    ImagePlus,
    Italic,
    List,
    ListIndentDecrease,
    ListIndentIncrease,
    ListOrdered,
    ListTodo,
    Minus,
    Pilcrow,
    Quote,
    SquareCode,
    SquarePen,
    Strikethrough,
    Table,
    Underline,
    X,
  } from "@lucide/svelte";
  import { createMarkdownEditor, type FormatCommand, type MarkdownEditor } from "./markdown-editor";
  import type { LinkPreviewRenderer } from "./link-preview-plugin";
  import { onKeyboardToggle, touchLayout } from "./viewport";

  interface Props {
    value: string;
    onchange: (markdown: string) => void;
    resolveImage: (source: string) => Promise<string>;
    saveImage: (data: Uint8Array, fileName: string) => Promise<string>;
    renderLinkPreview: LinkPreviewRenderer;
    editing?: boolean;
  }

  interface Tool {
    label: string;
    icon: Component<{ size?: number }>;
    run: () => void;
    state?: FormatCommand;
  }

  interface TextStyle {
    label: string;
    command: FormatCommand;
  }

  let { value, onchange, resolveImage, saveImage, renderLinkPreview, editing = $bindable(false) }: Props = $props();
  let root: HTMLDivElement;
  let fileInput: HTMLInputElement;
  let editor = $state.raw<MarkdownEditor | undefined>();
  let activeFormats = $state.raw<ReadonlySet<FormatCommand>>(new Set());
  let editorFocused = $state(false);
  let formatPanelOpen = $state(false);

  const touchEditing = $derived(touchLayout.current && (editorFocused || formatPanelOpen));

  $effect(() => {
    editing = touchEditing;
  });

  const format = (command: FormatCommand) => () => editor?.format(command);
  const toggle = (label: string, icon: Tool["icon"], command: FormatCommand): Tool => ({
    label,
    icon,
    run: format(command),
    state: command,
  });
  const action = (label: string, icon: Tool["icon"], run: () => void): Tool => ({ label, icon, run });

  const bold = toggle("Gras", Bold, "bold");
  const italic = toggle("Italique", Italic, "italic");
  const underline = toggle("Souligné", Underline, "underline");
  const strike = toggle("Barré", Strikethrough, "strike");
  const inlineCode = toggle("Code", Code, "code");
  const bulletList = toggle("Liste à puces", List, "bulletList");
  const orderedList = toggle("Liste numérotée", ListOrdered, "orderedList");
  const taskList = toggle("Liste de tâches", ListTodo, "taskList");
  const quote = toggle("Citation", Quote, "quote");
  const codeBlock = toggle("Bloc de code", SquareCode, "codeBlock");
  const outdent = action("Diminuer le retrait", ListIndentDecrease, format("outdent"));
  const indent = action("Augmenter le retrait", ListIndentIncrease, format("indent"));
  const rule = action("Séparateur", Minus, format("rule"));
  const table = action("Tableau", Table, () => editor?.insertTable());
  const image = action("Image", ImagePlus, () => fileInput.click());

  const desktopGroups: Tool[][] = [
    [
      toggle("Texte", Pilcrow, "paragraph"),
      toggle("Titre", Heading1, "heading1"),
      toggle("Sous-titre", Heading2, "heading2"),
      toggle("Intertitre", Heading3, "heading3"),
    ],
    [bold, italic, underline, strike, inlineCode],
    [bulletList, orderedList, taskList, quote, codeBlock],
    [table, image, rule],
  ];

  const quickTools: Tool[] = [taskList, table, image, bold, italic];

  const textStyles: TextStyle[] = [
    { label: "Titre", command: "heading1" },
    { label: "Sous-titre", command: "heading2" },
    { label: "Intertitre", command: "heading3" },
    { label: "Texte", command: "paragraph" },
  ];

  const panelRows: Tool[][][] = [
    [[bold, italic, underline, strike, inlineCode]],
    [
      [bulletList, taskList, orderedList],
      [outdent, indent],
    ],
    [[quote, codeBlock, rule]],
  ];

  export function undo(): void {
    editor?.undo();
  }

  function keepEditorFocus(event: MouseEvent): void {
    event.preventDefault();
  }

  function blurEditor(): void {
    const focused = document.activeElement;
    if (focused instanceof HTMLElement && root.contains(focused)) focused.blur();
  }

  function openFormatPanel(): void {
    formatPanelOpen = true;
    blurEditor();
  }

  function closeFormatPanel(): void {
    formatPanelOpen = false;
    editor?.focus();
  }

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
      onActiveFormatsChange: (active) => (activeFormats = active),
    });

    created.then((instance) => (editor = instance));

    const stopWatchingKeyboard = onKeyboardToggle((open) => {
      if (open && editorFocused) requestAnimationFrame(() => editor?.revealCursor());
      if (!open && editorFocused && !formatPanelOpen) blurEditor();
    });

    return () => {
      stopWatchingKeyboard();
      editor = undefined;
      created.then((instance) => instance.destroy());
    };
  });
</script>

{#snippet toolButton(tool: Tool, size: number)}
  {@const Icon = tool.icon}
  <button
    type="button"
    class="tool"
    aria-label={tool.label}
    title={tool.label}
    aria-pressed={tool.state ? activeFormats.has(tool.state) : undefined}
    disabled={!editor}
    onmousedown={keepEditorFocus}
    onclick={tool.run}
  >
    <Icon {size} />
  </button>
{/snippet}

<div class="editor" class:panel-open={formatPanelOpen}>
  {#if !touchLayout.current}
    <div class="format-bar" role="toolbar" aria-label="Mise en forme">
      <div class="tools">
        {#each desktopGroups as group, index (index)}
          <div class="group">
            {#each group as tool (tool.label)}
              {@render toolButton(tool, 16)}
            {/each}
          </div>
        {/each}
      </div>
    </div>
  {/if}
  <input bind:this={fileInput} type="file" accept="image/*" multiple hidden onchange={insertPickedImages} />

  <div
    class="content"
    bind:this={root}
    onfocusin={() => {
      editorFocused = true;
      formatPanelOpen = false;
    }}
    onfocusout={() => (editorFocused = false)}
  ></div>
</div>

{#if touchLayout.current}
  {#if formatPanelOpen}
    <div class="format-panel" role="toolbar" aria-label="Format">
      <header class="panel-header">
        <span class="panel-title">Format</span>
        <button
          type="button"
          class="panel-close"
          aria-label="Fermer le panneau Format"
          onmousedown={keepEditorFocus}
          onclick={closeFormatPanel}
        >
          <X size={16} />
        </button>
      </header>

      <div class="text-styles">
        {#each textStyles as style (style.command)}
          <button
            type="button"
            class="text-style {style.command}"
            aria-pressed={activeFormats.has(style.command)}
            disabled={!editor}
            onmousedown={keepEditorFocus}
            onclick={format(style.command)}
          >
            {style.label}
          </button>
        {/each}
      </div>

      {#each panelRows as row, rowIndex (rowIndex)}
        <div class="panel-row">
          {#each row as group, groupIndex (groupIndex)}
            <div class="segment">
              {#each group as tool (tool.label)}
                {@render toolButton(tool, 18)}
              {/each}
            </div>
          {/each}
        </div>
      {/each}
    </div>
  {:else if touchEditing}
    <div class="quick-bar" role="toolbar" aria-label="Mise en forme">
      <button
        type="button"
        class="tool"
        aria-label="Format"
        title="Format"
        disabled={!editor}
        onmousedown={keepEditorFocus}
        onclick={openFormatPanel}
      >
        <CaseSensitive size={20} />
      </button>
      {#each quickTools as tool (tool.label)}
        {@render toolButton(tool, 18)}
      {/each}
    </div>
  {:else}
    <button type="button" class="edit-fab" aria-label="Modifier la note" disabled={!editor} onclick={() => editor?.focusEnd()}>
      <SquarePen size={22} />
    </button>
  {/if}
{/if}

<style>
  .editor {
    display: flex;
    flex-direction: column;
    gap: 0.75rem;
  }

  .editor.panel-open {
    padding-bottom: 18rem;
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
    flex-shrink: 0;
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

  .tool {
    display: grid;
    flex-shrink: 0;
    place-items: center;
    width: 32px;
    height: 32px;
    border: 0;
    border-radius: var(--app-radius);
    background: transparent;
    color: var(--app-dim);
    cursor: pointer;
  }

  .tool:hover:not(:disabled) {
    background: var(--app-hover);
    color: var(--app-fg);
  }

  .tool:active:not(:disabled) {
    background: var(--app-active);
  }

  .tool[aria-pressed="true"],
  .text-style[aria-pressed="true"] {
    background: var(--app-accent-selected);
    color: var(--app-accent-text);
  }

  .tool:disabled,
  .text-style:disabled {
    opacity: 0.5;
    cursor: default;
  }

  .quick-bar,
  .format-panel,
  .edit-fab {
    position: absolute;
    z-index: 2;
    box-shadow:
      0 0 0 1px var(--app-border),
      0 2px 8px var(--app-shadow);
  }

  .quick-bar {
    bottom: 10px;
    left: 50%;
    display: flex;
    gap: 4px;
    max-width: calc(100% - 20px);
    padding: 4px;
    overflow-x: auto;
    border-radius: 999px;
    background: var(--app-popover-bg);
    scrollbar-width: none;
    transform: translateX(-50%);
  }

  .quick-bar .tool,
  .segment .tool {
    width: 40px;
    height: 40px;
    border-radius: 999px;
    color: var(--app-fg);
  }

  .edit-fab {
    right: 16px;
    bottom: 16px;
    display: grid;
    place-items: center;
    width: 56px;
    height: 56px;
    border: 0;
    border-radius: var(--kit-shape-xl);
    background: var(--app-accent);
    color: var(--app-accent-fg);
    cursor: pointer;
  }

  .format-panel {
    inset-inline: 8px;
    bottom: 8px;
    display: flex;
    flex-direction: column;
    gap: 12px;
    max-width: 30rem;
    margin-inline: auto;
    padding: 12px;
    border-radius: var(--kit-shape-xl);
    background: var(--app-popover-bg);
  }

  .panel-header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding-inline-start: 4px;
  }

  .panel-title {
    font-weight: 700;
  }

  .panel-close {
    display: grid;
    place-items: center;
    width: 32px;
    height: 32px;
    border: 0;
    border-radius: 999px;
    background: var(--app-hover);
    color: var(--app-fg);
    cursor: pointer;
  }

  .text-styles {
    display: flex;
    gap: 6px;
    overflow-x: auto;
    scrollbar-width: none;
  }

  .text-style {
    flex-shrink: 0;
    padding: 6px 14px;
    border: 0;
    border-radius: 999px;
    background: var(--app-hover);
    color: var(--app-fg);
    font: inherit;
    white-space: nowrap;
    cursor: pointer;
  }

  .text-style.heading1 {
    font-size: 1.25rem;
    font-weight: 800;
  }

  .text-style.heading2 {
    font-size: 1.1rem;
    font-weight: 700;
  }

  .text-style.heading3 {
    font-weight: 700;
  }

  .panel-row {
    display: flex;
    flex-wrap: wrap;
    gap: 8px;
  }

  .segment {
    display: flex;
    gap: 2px;
    padding: 3px;
    border-radius: 999px;
    background: var(--app-hover);
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
    box-shadow: 0 0 0 1px var(--app-border);
  }

  .content :global(.image-frame[data-state="ready"] .image-status) {
    display: none;
  }

  .content :global(.image-frame:not([data-state="ready"])) {
    display: flex;
    align-items: center;
    justify-content: center;
    width: 100%;
    min-height: 10rem;
    border-radius: 12px;
    background: var(--app-hover);
    color: var(--app-dim);
    font-size: 0.9rem;
  }

  .content :global(.image-frame:not([data-state="ready"]) img) {
    display: none;
  }

  .content :global(.image-frame[data-state="loading"]) {
    animation: image-loading-pulse 1.2s ease-in-out infinite alternate;
  }

  @keyframes -global-image-loading-pulse {
    from {
      opacity: 1;
    }

    to {
      opacity: 0.5;
    }
  }

  @media (prefers-reduced-motion: reduce) {
    .content :global(.image-frame[data-state="loading"]) {
      animation: none;
    }
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
