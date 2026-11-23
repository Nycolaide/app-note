<script lang="ts">
  import type { Vault, VaultDescriptor, VaultRegistry } from "$lib/core";

  interface Props {
    registry: VaultRegistry;
    vaults: VaultDescriptor[];
    onmove: (target: Vault, folder: string) => Promise<void>;
    onerror: (message: string) => void;
  }

  let { registry, vaults, onmove, onerror }: Props = $props();

  let target = $state.raw<Vault | null>(null);
  let folders = $state.raw<string[]>([]);
  let folder = $state("");
  let busy = $state(false);

  async function choose(event: Event): Promise<void> {
    const id = (event.currentTarget as HTMLSelectElement).value;
    const descriptor = vaults.find((vault) => vault.id === id);
    target = null;
    folders = [];
    folder = "";
    if (!descriptor) return;

    busy = true;
    try {
      const session = await registry.open(descriptor);
      target = session.vault;
      folders = session.vault.folders();
    } catch (cause) {
      onerror(cause instanceof Error ? cause.message : String(cause));
    } finally {
      busy = false;
    }
  }

  async function move(): Promise<void> {
    if (!target) return;
    busy = true;
    try {
      await onmove(target, folder);
      target = null;
      folders = [];
    } finally {
      busy = false;
    }
  }
</script>

{#if vaults.length > 0}
  <div>
    Vers un autre vault :
    <select onchange={choose} disabled={busy}>
      <option value="">—</option>
      {#each vaults as vault (vault.id)}
        <option value={vault.id}>{vault.name}</option>
      {/each}
    </select>
    {#if target}
      <select bind:value={folder}>
        {#each folders as path (path)}
          <option value={path}>{path === "" ? "Notes" : path}</option>
        {/each}
      </select>
      <button onclick={move} disabled={busy}>Déplacer vers ce vault</button>
    {/if}
  </div>
{/if}
