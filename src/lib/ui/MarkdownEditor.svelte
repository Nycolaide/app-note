<script lang="ts">
  import { onMount } from "svelte";
  import { Editor, defaultValueCtx, remarkStringifyOptionsCtx, rootCtx } from "@milkdown/kit/core";
  import { commonmark } from "@milkdown/kit/preset/commonmark";
  import { gfm } from "@milkdown/kit/preset/gfm";
  import { history } from "@milkdown/kit/plugin/history";
  import { clipboard } from "@milkdown/kit/plugin/clipboard";
  import { listener, listenerCtx } from "@milkdown/kit/plugin/listener";

  interface Props {
    value: string;
    onchange: (markdown: string) => void;
  }

  let { value, onchange }: Props = $props();
  let root: HTMLDivElement;

  onMount(() => {
    const initialValue = value;

    const created = Editor.make()
      .config((ctx) => {
        ctx.set(rootCtx, root);
        ctx.set(defaultValueCtx, initialValue);
        ctx.update(remarkStringifyOptionsCtx, (options) => ({ ...options, bullet: "-" as const, rule: "-" as const }));
        ctx.get(listenerCtx).markdownUpdated((_, markdown, previous) => {
          if (markdown !== previous) onchange(markdown);
        });
      })
      .use(commonmark)
      .use(gfm)
      .use(history)
      .use(clipboard)
      .use(listener)
      .create();

    return () => {
      created.then((editor) => editor.destroy());
    };
  });
</script>

<div class="markdown-editor" bind:this={root}></div>

<style>
  .markdown-editor :global(.ProseMirror) {
    min-height: 20rem;
    outline: none;
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
