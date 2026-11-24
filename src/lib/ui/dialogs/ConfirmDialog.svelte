<script lang="ts">
  interface Props {
    open: boolean;
    title: string;
    message: string;
    confirmLabel: string;
    error: string;
    onconfirm: () => Promise<boolean>;
  }

  let { open = $bindable(), title, message, confirmLabel, error, onconfirm }: Props = $props();
  let busy = $state(false);

  async function confirm(): Promise<void> {
    busy = true;
    try {
      if (await onconfirm()) open = false;
    } finally {
      busy = false;
    }
  }
</script>

<kit:dialog bind:open size="sm" rounded="xl">
  <div class="alert-dialog">
    <h2>{title}</h2>
    <p class="dim">{message}</p>
    {#if error}
      <p class="error">{error}</p>
    {/if}
    <div class="responses">
      <kit:btn variant="tonal" onclick={() => (open = false)}>Annuler</kit:btn>
      <kit:btn variant="filled" color="error" loading={busy} onclick={confirm}>{confirmLabel}</kit:btn>
    </div>
  </div>
</kit:dialog>
