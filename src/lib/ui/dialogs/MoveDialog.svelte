<script lang="ts">
  import { Check, Cloud, Folder, HardDrive } from "@lucide/svelte";
  import { isSameOrInside, parentPath, type VaultDescriptor } from "$lib/core";
  import { folderLabel, type Destination } from "../notes-app.svelte";

  interface Props {
    open: boolean;
    kind: "note" | "folder";
    path: string;
    vaults: VaultDescriptor[];
    current: VaultDescriptor | null;
    loadFolders: (vault: VaultDescriptor) => Promise<string[]>;
    error: string;
    onmove: (destination: Destination) => Promise<boolean>;
  }

  let { open = $bindable(), kind, path, vaults, current, loadFolders, error, onmove }: Props = $props();

  let vaultId = $state("");
  let folders = $state.raw<string[]>([]);
  let folder = $state<string | null>(null);
  let loading = $state(false);
  let busy = $state(false);

  const vault = $derived(vaults.find((descriptor) => descriptor.id === vaultId) ?? null);
  const sameVault = $derived(vault?.id === current?.id);
  const currentParent = $derived(parentPath(path));

  $effect.pre(() => {
    if (open && current) selectVault(current.id);
  });

  async function selectVault(id: string): Promise<void> {
    vaultId = id;
    folder = null;
    const descriptor = vaults.find((candidate) => candidate.id === id);
    if (!descriptor) return;
    loading = true;
    try {
      folders = await loadFolders(descriptor);
    } finally {
      loading = false;
    }
  }

  function isDisabled(candidate: string): boolean {
    if (!sameVault) return false;
    if (kind === "folder" && isSameOrInside(candidate, path)) return true;
    return candidate === currentParent;
  }

  function depth(candidate: string): number {
    return candidate === "" ? 0 : candidate.split("/").length;
  }

  async function submit(): Promise<void> {
    if (!vault || folder === null) return;
    busy = true;
    try {
      if (await onmove({ vault, folder })) open = false;
    } finally {
      busy = false;
    }
  }
</script>

<kit:dialog bind:open size="md" rounded="xl">
  <div class="form-dialog">
    <header>
      <kit:btn variant="tonal" onclick={() => (open = false)}>Annuler</kit:btn>
      <h2>Déplacer {kind === "note" ? "la note" : "le dossier"}</h2>
      <kit:btn variant="filled" color="accent" loading={busy} disabled={folder === null} onclick={submit}>Déplacer</kit:btn>
    </header>

    {#if vaults.length > 1}
      <div class="vaults" role="radiogroup" aria-label="Vault de destination">
        {#each vaults as descriptor (descriptor.id)}
          <kit:chip
            is="button"
            size="sm"
            rounded="full"
            variant={descriptor.id === vaultId ? "filled" : "outline"}
            color={descriptor.id === vaultId ? "accent" : undefined}
            role="radio"
            aria-checked={descriptor.id === vaultId}
            onclick={() => selectVault(descriptor.id)}
          >
            {#snippet prepend()}
              {#if descriptor.remote}<Cloud size={14} />{:else}<HardDrive size={14} />{/if}
            {/snippet}
            {descriptor.name}
          </kit:chip>
        {/each}
      </div>
    {/if}

    <ul class="folders" aria-busy={loading}>
      {#each folders as candidate (candidate)}
        <li>
          <button
            type="button"
            class:selected={folder === candidate}
            disabled={isDisabled(candidate)}
            style:--depth={depth(candidate)}
            onclick={() => (folder = candidate)}
          >
            <Folder size={16} />
            <span class="grow">{folderLabel(candidate)}</span>
            {#if folder === candidate}<Check size={16} />{/if}
          </button>
        </li>
      {/each}
    </ul>

    {#if !sameVault}
      <p class="hint dim">
        {kind === "note" ? "La note est copiée" : "Le dossier est copié"} dans « {vault?.name} » avec ses images,
        puis l'original est mis à la corbeille de ce vault.
      </p>
    {/if}

    {#if error}
      <p class="error">{error}</p>
    {/if}
  </div>
</kit:dialog>

<style>
  .vaults {
    display: flex;
    flex-wrap: wrap;
    justify-content: center;
    gap: 6px;
  }

  .folders {
    max-height: 18rem;
    margin: 0;
    padding: 0;
    overflow-y: auto;
    border-radius: 12px;
    background: var(--app-card-bg);
    box-shadow: 0 0 0 1px var(--app-border);
    list-style: none;
  }

  .folders li + li {
    border-top: 1px solid var(--app-border);
  }

  .folders button {
    display: flex;
    align-items: center;
    gap: 10px;
    width: 100%;
    min-height: 44px;
    padding: 0 12px;
    padding-inline-start: calc(12px + var(--depth) * 18px);
    border: 0;
    background: transparent;
    color: inherit;
    text-align: start;
    cursor: pointer;
  }

  .folders button:hover:not(:disabled) {
    background: var(--app-hover);
  }

  .folders button.selected {
    color: var(--app-accent-text);
    font-weight: 600;
  }

  .folders button:disabled {
    opacity: 0.4;
    cursor: default;
  }

  .grow {
    flex: 1;
  }

  .hint {
    font-size: 0.85rem;
    text-align: center;
  }
</style>
