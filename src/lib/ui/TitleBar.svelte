<script lang="ts">
  import { getCurrentWindow } from "@tauri-apps/api/window";

  const appWindow = getCurrentWindow();
  const isMobile = /android|iphone|ipad/i.test(navigator.userAgent);
</script>

{#if !isMobile}
  <header data-tauri-drag-region>
    <span data-tauri-drag-region>app-note</span>
    <div>
      <button onclick={() => appWindow.minimize()}>_</button>
      <button onclick={() => appWindow.toggleMaximize()}>□</button>
      <button onclick={() => appWindow.close()}>×</button>
    </div>
  </header>
{/if}

<style>
  header {
    display: flex;
    justify-content: space-between;
    align-items: center;
    user-select: none;
  }
</style>
