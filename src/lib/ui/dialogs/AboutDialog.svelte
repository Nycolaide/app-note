<script lang="ts">
  import { getName, getVersion } from "@tauri-apps/api/app";
  import { openUrl } from "@tauri-apps/plugin-opener";
  import { ExternalLink } from "@lucide/svelte";

  interface Props {
    open: boolean;
  }

  let { open = $bindable() }: Props = $props();

  const REPOSITORY_URL = "https://github.com/Nycolaide/app-note";
  const CREATOR = { name: "Nycolaide", url: "https://nycolaide.dev" };

  const details = Promise.all([getName(), getVersion()]);
</script>

<kit:dialog bind:open size="sm" rounded="xl">
  <div class="alert-dialog about">
    <img src="/runote.svg" alt="" width="96" height="96" />
    {#await details then [name, version]}
      <h2>{name}</h2>
      <button type="button" class="creator" onclick={() => openUrl(CREATOR.url)}>{CREATOR.name}</button>
      <span class="version">Version {version}</span>
    {/await}

    <ul class="links">
      <li>
        <button type="button" class="row-button" onclick={() => openUrl(CREATOR.url)}>
          <span class="grow">Site du créateur</span>
          <ExternalLink size={16} />
        </button>
      </li>
      <li>
        <button type="button" class="row-button" onclick={() => openUrl(REPOSITORY_URL)}>
          <span class="grow">Dépôt GitHub</span>
          <ExternalLink size={16} />
        </button>
      </li>
    </ul>

    <div class="responses">
      <kit:btn variant="tonal" onclick={() => (open = false)}>Fermer</kit:btn>
    </div>
  </div>
</kit:dialog>

<style>
  .about {
    align-items: center;
  }

  img {
    margin-top: 12px;
    border-radius: 18px;
  }

  .about h2 {
    margin: 0;
    font-size: 1.5rem;
  }

  .creator {
    padding: 0;
    border: 0;
    background: transparent;
    color: var(--app-dim);
    font: inherit;
    cursor: pointer;
  }

  .creator:hover {
    color: var(--app-accent-text);
    text-decoration: underline;
  }

  .version {
    padding: 4px 12px;
    border-radius: 9999px;
    background: var(--app-accent-selected);
    color: var(--app-accent-text);
    font-size: 0.85rem;
    font-weight: 700;
  }

  .links {
    width: 100%;
    margin: 6px 0 0;
    padding: 0;
    overflow: hidden;
    border-radius: 12px;
    background: var(--app-card-bg);
    box-shadow: 0 0 0 1px var(--app-border);
    list-style: none;
  }

  .links li + li {
    border-top: 1px solid var(--app-border);
  }

  .links .row-button {
    min-height: 48px;
    padding-inline: 12px;
    border-radius: 0;
  }

  .grow {
    flex: 1;
  }

  .responses {
    width: 100%;
  }
</style>
