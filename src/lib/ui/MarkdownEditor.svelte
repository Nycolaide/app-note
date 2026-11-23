<script lang="ts">
  import { onMount } from "svelte";
  import { createMarkdownEditor, type MarkdownEditor } from "./markdown-editor";
  import type { LinkPreviewRenderer } from "./link-preview-plugin";

  interface Props {
    value: string;
    onchange: (markdown: string) => void;
    resolveImage: (source: string) => Promise<string>;
    saveImage: (data: Uint8Array, fileName: string) => Promise<string>;
    renderLinkPreview: LinkPreviewRenderer;
  }

  let { value, onchange, resolveImage, saveImage, renderLinkPreview }: Props = $props();
  let root: HTMLDivElement;
  let fileInput: HTMLInputElement;
  let editor: MarkdownEditor | undefined;

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

<div>
  <button type="button" onclick={() => editor?.insertTable()}>Tableau</button>
  <button type="button" onclick={() => fileInput.click()}>Image</button>
  <input bind:this={fileInput} type="file" accept="image/*" multiple hidden onchange={insertPickedImages} />
</div>

<div class="markdown-editor" bind:this={root}></div>

<style>
  .markdown-editor :global(.ProseMirror) {
    min-height: 20rem;
    outline: none;
  }

  .markdown-editor :global(img) {
    max-width: 100%;
  }

  .markdown-editor :global(.link-preview) {
    display: block;
    max-width: 30rem;
    border: 1px solid currentColor;
    padding: 0.5rem;
    cursor: pointer;
  }

  .markdown-editor :global(.link-preview img) {
    display: block;
    max-height: 10rem;
  }

  .markdown-editor :global(table) {
    border-collapse: collapse;
  }

  .markdown-editor :global(th),
  .markdown-editor :global(td) {
    border: 1px solid currentColor;
    padding: 0.25rem 0.5rem;
  }
</style>
