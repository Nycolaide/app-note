<script lang="ts">
  interface Props {
    open: boolean;
    title: string;
    label: string;
    initial?: string;
    confirmLabel: string;
    error: string;
    onsubmit: (name: string) => Promise<boolean>;
  }

  let { open = $bindable(), title, label, initial = "", confirmLabel, error, onsubmit }: Props = $props();
  let name = $state("");
  let busy = $state(false);

  $effect.pre(() => {
    if (open) name = initial;
  });

  async function submit(event: SubmitEvent): Promise<void> {
    event.preventDefault();
    if (name.trim() === "") return;
    busy = true;
    try {
      if (await onsubmit(name.trim())) open = false;
    } finally {
      busy = false;
    }
  }
</script>

<kit:dialog bind:open size="sm" rounded="xl">
  <form class="alert-dialog" onsubmit={submit}>
    <h2>{title}</h2>
    <kit:textfield {label} variant="tonal" bind:value={name} autofocus />
    {#if error}
      <p class="error">{error}</p>
    {/if}
    <div class="responses">
      <kit:btn variant="tonal" onclick={() => (open = false)}>Annuler</kit:btn>
      <kit:btn type="submit" variant="filled" color="accent" loading={busy} disabled={name.trim() === ""}>{confirmLabel}</kit:btn>
    </div>
  </form>
</kit:dialog>
