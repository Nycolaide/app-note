<script lang="ts">
  import { Hash, X } from "@lucide/svelte";

  interface Props {
    tags: string[];
    suggestions: string[];
    onchange: (tags: string[]) => void;
  }

  let { tags, suggestions, onchange }: Props = $props();
  let input = $state("");

  const MAX_SUGGESTIONS = 6;
  const typed = $derived(input.trim().replace(/^#/, "").toLocaleLowerCase());
  const matches = $derived(
    typed === ""
      ? []
      : suggestions
          .filter((tag) => !tags.includes(tag) && tag.toLocaleLowerCase().startsWith(typed) && tag.toLocaleLowerCase() !== typed)
          .slice(0, MAX_SUGGESTIONS),
  );

  function add(value = input): void {
    const tag = value.trim().replace(/^#/, "");
    input = "";
    if (tag && !tags.includes(tag)) onchange([...tags, tag]);
  }

  function remove(tag: string): void {
    onchange(tags.filter((existing) => existing !== tag));
  }

  function handleKey(event: KeyboardEvent): void {
    if (event.key === "Enter" || event.key === ",") {
      event.preventDefault();
      add();
    } else if (event.key === "Backspace" && input === "" && tags.length > 0) {
      remove(tags[tags.length - 1]);
    }
  }
</script>

<div class="tags">
  {#each tags as tag (tag)}
    <kit:chip size="sm" variant="tonal" rounded="full">
      #{tag}
      {#snippet append()}
        <button type="button" class="remove" aria-label={`Retirer le tag ${tag}`} onclick={() => remove(tag)}>
          <X size={12} />
        </button>
      {/snippet}
    </kit:chip>
  {/each}

  <label class="add">
    <Hash size={14} />
    <input
      placeholder={tags.length === 0 ? "Ajouter un tag" : "Tag"}
      bind:value={input}
      onkeydown={handleKey}
      onblur={() => add()}
    />
  </label>

  {#each matches as tag (tag)}
    <button type="button" class="suggestion" onmousedown={(event) => event.preventDefault()} onclick={() => add(tag)}>
      #{tag}
    </button>
  {/each}
</div>

<style>
  .tags {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 0.375rem;
  }

  .remove {
    display: grid;
    place-items: center;
    padding: 0;
    border: 0;
    background: transparent;
    color: inherit;
    cursor: pointer;
    opacity: 0.7;
  }

  .remove:hover {
    opacity: 1;
  }

  .add {
    display: flex;
    align-items: center;
    gap: 0.25rem;
    color: var(--app-dim);
  }

  input {
    width: 7rem;
    padding: 0.25rem 0;
    border: 0;
    outline: none;
    background: transparent;
    color: var(--app-fg);
    font: inherit;
    font-size: 0.9rem;
  }

  .suggestion {
    padding: 0.125rem 0.5rem;
    border: 1px dashed var(--app-border);
    border-radius: 9999px;
    background: transparent;
    color: var(--app-dim);
    font-size: 0.8rem;
    cursor: pointer;
  }

  .suggestion:hover {
    border-style: solid;
    color: var(--app-fg);
  }
</style>
