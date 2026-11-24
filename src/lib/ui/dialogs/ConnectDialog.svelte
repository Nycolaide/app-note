<script lang="ts">
  import { openUrl } from "@tauri-apps/plugin-opener";
  import { Check, FlaskConical, Plus, Server } from "@lucide/svelte";
  import type { ConnectRequest, DriveFolder, GoogleDriveConnection, GoogleDriveConnectRequest } from "$lib/core";

  type Provider = "google-drive" | "webdav";

  interface Props {
    open: boolean;
    error: string;
    googleDriveAvailable: boolean;
    onconnect: (request: ConnectRequest) => Promise<boolean>;
    ongooglesignin: () => Promise<GoogleDriveConnection | undefined>;
    ongooglecancel: () => void;
    ongoogleconnect: (request: GoogleDriveConnectRequest) => Promise<boolean>;
  }

  let {
    open = $bindable(),
    error,
    googleDriveAvailable,
    onconnect,
    ongooglesignin,
    ongooglecancel,
    ongoogleconnect,
  }: Props = $props();

  const BETA_CONTACT = "laurent@nycolaide.dev";

  let provider = $state<Provider>("webdav");
  let busy = $state(false);

  let name = $state("");
  let url = $state("");
  let username = $state("");
  let password = $state("");

  let signingIn = $state(false);
  let connection = $state.raw<GoogleDriveConnection | null>(null);
  let chosenFolder = $state.raw<DriveFolder | null>(null);
  let newVaultName = $state("");

  const webDavComplete = $derived([name, url, username, password].every((value) => value.trim() !== ""));
  const googleComplete = $derived(connection !== null && (chosenFolder !== null || newVaultName.trim() !== ""));
  const complete = $derived(provider === "webdav" ? webDavComplete : googleComplete);

  $effect.pre(() => {
    if (open) reset();
  });

  function reset(): void {
    provider = googleDriveAvailable ? "google-drive" : "webdav";
    name = url = username = password = newVaultName = "";
    connection = null;
    chosenFolder = null;
    signingIn = false;
  }

  function close(): void {
    if (signingIn) ongooglecancel();
    open = false;
  }

  async function signIn(): Promise<void> {
    signingIn = true;
    try {
      connection = (await ongooglesignin()) ?? null;
      chosenFolder = connection?.folders[0] ?? null;
    } finally {
      signingIn = false;
    }
  }

  function cancelSignIn(): void {
    ongooglecancel();
  }

  async function submit(event: SubmitEvent): Promise<void> {
    event.preventDefault();
    if (!complete || busy) return;
    busy = true;
    try {
      const connected =
        provider === "webdav"
          ? await onconnect({ name, url: url.trim(), username: username.trim(), password })
          : await ongoogleconnect({
              refreshToken: connection!.refreshToken,
              account: connection!.account,
              folder: chosenFolder ?? { name: newVaultName.trim() },
            });
      if (connected) open = false;
    } finally {
      busy = false;
    }
  }
</script>

<kit:dialog bind:open size="md" rounded="xl">
  <form class="form-dialog" onsubmit={submit}>
    <header>
      <kit:btn variant="tonal" onclick={close}>Annuler</kit:btn>
      <h2>Ajouter un vault</h2>
      <kit:btn type="submit" variant="filled" color="accent" loading={busy} disabled={!complete}>Ajouter</kit:btn>
    </header>

    {#if googleDriveAvailable}
      <div class="providers" role="radiogroup" aria-label="Type de vault">
        <button
          type="button"
          role="radio"
          aria-checked={provider === "google-drive"}
          disabled={signingIn}
          onclick={() => (provider = "google-drive")}
        >
          <svg class="google-logo" viewBox="0 0 24 24" aria-hidden="true">
            <path fill="#4285F4" d="M22.6 12.2c0-.8-.1-1.5-.2-2.2H12v4.2h5.9a5 5 0 0 1-2.2 3.3v2.7h3.6c2.1-1.9 3.3-4.8 3.3-8z" />
            <path fill="#34A853" d="M12 23c3 0 5.5-1 7.3-2.7l-3.6-2.8c-1 .7-2.2 1.1-3.7 1.1-2.9 0-5.3-1.9-6.2-4.5H2.1v2.9A11 11 0 0 0 12 23z" />
            <path fill="#FBBC05" d="M5.8 14.1a6.6 6.6 0 0 1 0-4.2V7H2.1a11 11 0 0 0 0 9.9l3.7-2.8z" />
            <path fill="#EA4335" d="M12 5.4c1.6 0 3.1.6 4.2 1.6l3.2-3.2A11 11 0 0 0 2.1 7l3.7 2.9C6.7 7.3 9.1 5.4 12 5.4z" />
          </svg>
          Google Drive
          <span class="beta-badge">Bêta</span>
        </button>
        <button
          type="button"
          role="radio"
          aria-checked={provider === "webdav"}
          disabled={signingIn}
          onclick={() => (provider = "webdav")}
        >
          <Server size={18} />
          WebDAV
        </button>
      </div>
    {/if}

    {#if provider === "google-drive"}
      {#if connection === null}
        <div class="beta-notice">
          <FlaskConical size={18} />
          <p>
            Fonctionnalité en bêta, accessible uniquement sur invitation. Pour y participer, envoie une demande à
            <button type="button" class="mail" onclick={() => openUrl(`mailto:${BETA_CONTACT}?subject=Runote%20%E2%80%93%20B%C3%AAta%20Google%20Drive`)}>
              {BETA_CONTACT}
            </button>.
          </p>
        </div>
        <p class="dim">
          Runote crée un dossier « Runote » dans ton Google Drive et n'a accès qu'aux fichiers qu'il y range.
        </p>
        {#if signingIn}
          <p class="waiting">Termine la connexion dans ton navigateur, puis reviens ici.</p>
          <kit:btn variant="tonal" onclick={cancelSignIn}>Annuler la connexion</kit:btn>
        {:else}
          <kit:btn variant="filled" color="accent" rounded="full" onclick={signIn}>Se connecter avec Google</kit:btn>
        {/if}
      {:else}
        <p class="dim">Connecté en tant que <strong>{connection.account || "compte Google"}</strong>.</p>
        <ul class="choices" role="radiogroup" aria-label="Vault Google Drive">
          {#each connection.folders as folder (folder.id)}
            <li>
              <button
                type="button"
                role="radio"
                aria-checked={chosenFolder?.id === folder.id}
                onclick={() => (chosenFolder = folder)}
              >
                <span class="grow">{folder.name}</span>
                {#if chosenFolder?.id === folder.id}<Check size={16} />{/if}
              </button>
            </li>
          {/each}
          <li>
            <button type="button" role="radio" aria-checked={chosenFolder === null} onclick={() => (chosenFolder = null)}>
              <Plus size={16} />
              <span class="grow">Nouveau vault</span>
              {#if chosenFolder === null}<Check size={16} />{/if}
            </button>
          </li>
        </ul>
        {#if chosenFolder === null}
          <kit:textfield label="Nom du nouveau vault" variant="tonal" bind:value={newVaultName} autofocus />
        {/if}
      {/if}
    {:else}
      <p class="dim">Les notes sont copiées sur cet appareil et synchronisées avec le serveur.</p>
      <kit:textfield label="Nom" variant="tonal" bind:value={name} autofocus />
      <kit:textfield
        label="Adresse WebDAV"
        type="url"
        variant="tonal"
        placeholder="https://cloud.exemple.fr/remote.php/dav/files/moi/Notes"
        bind:value={url}
      />
      <kit:textfield label="Utilisateur" variant="tonal" autocomplete="username" bind:value={username} />
      <kit:textfield
        label="Mot de passe d'application"
        type="password"
        variant="tonal"
        autocomplete="current-password"
        bind:value={password}
      />
    {/if}

    {#if error}
      <p class="error">{error}</p>
    {/if}
  </form>
</kit:dialog>

<style>
  .providers {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: 6px;
    padding: 3px;
    border-radius: 12px;
    background: var(--app-hover);
  }

  .providers button {
    display: flex;
    align-items: center;
    justify-content: center;
    gap: 8px;
    min-height: 38px;
    border: 0;
    border-radius: 9px;
    background: transparent;
    color: inherit;
    font: inherit;
    font-weight: 600;
    cursor: pointer;
  }

  @media (max-width: 480px) {
    .providers button {
      gap: 6px;
      font-size: 0.9rem;
      white-space: nowrap;
    }
  }

  .providers button[aria-checked="true"] {
    background: var(--app-card-bg);
    box-shadow: 0 1px 3px var(--app-shadow);
  }

  .providers button:disabled {
    opacity: 0.6;
    cursor: default;
  }

  @media (max-width: 480px) {
    .providers .beta-badge {
      padding: 1px 5px;
      font-size: 0.62rem;
    }
  }

  .beta-notice {
    display: flex;
    align-items: flex-start;
    gap: 10px;
    padding: 10px 12px;
    border-radius: 12px;
    background: var(--app-accent-selected);
    color: var(--app-fg);
    font-size: 0.9rem;
  }

  .beta-notice :global(svg) {
    flex-shrink: 0;
    margin-top: 1px;
    color: var(--app-accent-text);
  }

  .beta-notice p {
    margin: 0;
  }

  .mail {
    padding: 0;
    border: 0;
    background: transparent;
    color: var(--app-accent-text);
    font: inherit;
    font-weight: 600;
    text-decoration: underline;
    cursor: pointer;
  }

  .google-logo {
    width: 18px;
    height: 18px;
  }

  .waiting {
    margin: 0;
    text-align: center;
  }

  .choices {
    margin: 0;
    padding: 0;
    overflow: hidden;
    border-radius: 12px;
    background: var(--app-card-bg);
    box-shadow: 0 0 0 1px var(--app-border);
    list-style: none;
  }

  .choices li + li {
    border-top: 1px solid var(--app-border);
  }

  .choices button {
    display: flex;
    align-items: center;
    gap: 10px;
    width: 100%;
    min-height: 44px;
    padding: 0 12px;
    border: 0;
    background: transparent;
    color: inherit;
    font: inherit;
    text-align: start;
    cursor: pointer;
  }

  .choices button:hover {
    background: var(--app-hover);
  }

  .choices button[aria-checked="true"] {
    color: var(--app-accent-text);
    font-weight: 600;
  }

  .grow {
    flex: 1;
  }
</style>
