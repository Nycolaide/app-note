<script lang="ts">
  import { PanelLeft } from "@lucide/svelte";
  import { sidebar } from "./layout.svelte";
  import { drawerLayout } from "./viewport";

  const label = $derived(drawerLayout.current ? "Afficher les dossiers" : "Afficher la barre latérale");
</script>

{#if drawerLayout.current || !sidebar.open}
  <button type="button" class="flat-button" aria-label={label} title="{label} (F9)" onclick={() => sidebar.toggle()}>
    <PanelLeft size={16} />
  </button>
{/if}
