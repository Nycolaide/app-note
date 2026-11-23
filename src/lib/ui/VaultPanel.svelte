<script lang="ts">
  import type { ConnectRequest, SyncStatus, VaultDescriptor } from "$lib/core";

  interface Props {
    vaults: VaultDescriptor[];
    current: VaultDescriptor | null;
    syncStatus: SyncStatus | null;
    onswitch: (descriptor: VaultDescriptor) => void;
    onsync: () => void;
    onremove: (descriptor: VaultDescriptor) => Promise<void>;
    onconnect: (request: ConnectRequest) => Promise<void>;
  }

  let { vaults, current, syncStatus, onswitch, onsync, onremove, onconnect }: Props = $props();

  let name = $state("");
  let url = $state("");
  let username = $state("");
  let password = $state("");
  let connecting = $state(false);
  let confirmingRemove = $state(false);

  function describe(descriptor: VaultDescriptor): string {
    return descriptor.remote ? `${descriptor.name} (WebDAV)` : descriptor.name;
  }

  function statusText(status: SyncStatus): string {
    if (status.running) return "Synchronisation…";
    if (status.lastError) return `Échec : ${status.lastError}`;
    if (status.lastSuccess) return `Synchronisé à ${status.lastSuccess.toLocaleTimeString()}`;
    return "Jamais synchronisé";
  }

  function select(event: Event): void {
    const id = (event.currentTarget as HTMLSelectElement).value;
    const descriptor = vaults.find((vault) => vault.id === id);
    confirmingRemove = false;
    if (descriptor) onswitch(descriptor);
  }

  async function connect(event: SubmitEvent): Promise<void> {
    event.preventDefault();
    connecting = true;

    try {
      await onconnect({ name, url, username, password });
      name = "";
      password = "";
    } finally {
      connecting = false;
    }
  }

  async function remove(): Promise<void> {
    confirmingRemove = false;
    if (current) await onremove(current);
  }
</script>

<fieldset>
  <legend>Vault</legend>

  <select value={current?.id} onchange={select}>
    {#each vaults as vault (vault.id)}
      <option value={vault.id}>{describe(vault)}</option>
    {/each}
  </select>

  {#if current?.remote && syncStatus}
    <button onclick={onsync} disabled={syncStatus.running}>Synchroniser</button>
    <small>{statusText(syncStatus)}</small>
    {#if syncStatus.lastReport?.conflicts.length}
      <small>— {syncStatus.lastReport.conflicts.length} conflit(s) : copies créées</small>
    {/if}
  {/if}

  {#if current?.remote}
    {#if confirmingRemove}
      Retirer ce vault ? (la copie locale est effacée, le distant est conservé)
      <button onclick={remove}>Oui, retirer</button>
      <button onclick={() => (confirmingRemove = false)}>Annuler</button>
    {:else}
      <button onclick={() => (confirmingRemove = true)}>Retirer ce vault</button>
    {/if}
  {/if}

  <details>
    <summary>Ajouter un vault WebDAV</summary>
    <form onsubmit={connect}>
      <input placeholder="Nom du vault" bind:value={name} required />
      <input type="url" placeholder="https://cloud.exemple.fr/remote.php/dav/files/moi/Notes" bind:value={url} required />
      <input placeholder="Utilisateur" bind:value={username} required autocomplete="username" />
      <input type="password" placeholder="Mot de passe d'application" bind:value={password} required autocomplete="current-password" />

      <button disabled={connecting}>{connecting ? "Connexion…" : "Connecter"}</button>
    </form>
  </details>
</fieldset>
