<script lang="ts">
  import { onMount, untrack } from "svelte";
  import { createGlobalTheme, useTheme } from "lapikit/hooks";
  import { NotebookPen, X } from "@lucide/svelte";
  import type { VaultDescriptor } from "$lib/core";
  import HeaderBar from "$lib/ui/HeaderBar.svelte";
  import Sidebar from "$lib/ui/panes/Sidebar.svelte";
  import NoteList from "$lib/ui/panes/NoteList.svelte";
  import TrashList from "$lib/ui/panes/TrashList.svelte";
  import NoteView from "$lib/ui/panes/NoteView.svelte";
  import NameDialog from "$lib/ui/dialogs/NameDialog.svelte";
  import MoveDialog from "$lib/ui/dialogs/MoveDialog.svelte";
  import ConnectDialog from "$lib/ui/dialogs/ConnectDialog.svelte";
  import ConfirmDialog from "$lib/ui/dialogs/ConfirmDialog.svelte";
  import AboutDialog from "$lib/ui/dialogs/AboutDialog.svelte";
  import type { FolderActions, ThemeName } from "$lib/ui/panes/types";
  import { folderLabel, NotesApp } from "$lib/ui/notes-app.svelte";
  import { drawerLayout, mobileLayout } from "$lib/ui/viewport";
  import { beforeWindowClose, hasWindowControls, trackWindowFrame, watchMobileAppVisibility } from "$lib/ui/window";
  import { sidebar } from "$lib/ui/layout.svelte";

  type NameRequest = { mode: "create"; parent: string } | { mode: "rename"; path: string };
  type MoveRequest = { kind: "note" | "folder"; path: string };
  type ConfirmRequest = { title: string; message: string; confirmLabel: string; run: () => Promise<unknown> };

  const THEME_KEY = "runote:theme";
  const app = new NotesApp();
  const globalTheme = createGlobalTheme({ key: THEME_KEY, name: "system" });

  let theme = $state<ThemeName>(asThemeName(globalTheme.active));
  let toast: HTMLDivElement;

  let nameOpen = $state(false);
  let nameRequest = $state.raw<NameRequest>({ mode: "create", parent: "" });
  let moveOpen = $state(false);
  let moveRequest = $state.raw<MoveRequest>({ kind: "note", path: "" });
  let connectOpen = $state(false);
  let aboutOpen = $state(false);
  let confirmOpen = $state(false);
  let confirmRequest = $state.raw<ConfirmRequest>({ title: "", message: "", confirmLabel: "", run: async () => {} });

  const listControls = $derived(hasWindowControls && mobileLayout.current);
  const drawerClosed = $derived(drawerLayout.current && !sidebar.drawerOpen);
  const dialogOpen = $derived(nameOpen || moveOpen || connectOpen || confirmOpen);
  const dialogError = $derived(dialogOpen ? app.error : "");

  const folderActions: FolderActions = {
    create: (parent) => askName({ mode: "create", parent }),
    rename: (path) => askName({ mode: "rename", path }),
    move: (path) => askMove({ kind: "folder", path }),
    trash: (path) =>
      askConfirm({
        title: "Mettre le dossier à la corbeille ?",
        message: `« ${folderLabel(path)} » et tout son contenu iront dans la corbeille. Vous pourrez le restaurer pendant 30 jours.`,
        confirmLabel: "Mettre à la corbeille",
        run: () => app.trashFolder(path),
      }),
  };

  onMount(() => {
    app.start();
    const stopTracking = trackWindowFrame(document.documentElement);
    const stopCloseGuard = beforeWindowClose(() => app.syncBeforeExit());
    const stopWatchingVisibility = watchMobileAppVisibility({
      onBackground: () => app.saveAndSyncAll(),
      onForeground: () => app.syncNow(),
    });
    return () => {
      stopWatchingVisibility();
      app.stop();
      stopTracking.then((stop) => stop());
      stopCloseGuard.then((stop) => stop());
    };
  });

  $effect(() => {
    void app.scope;
    void app.selectedNotePath;
    void app.session;
    void drawerLayout.current;
    untrack(() => sidebar.closeDrawer());
  });

  function handleKey(event: KeyboardEvent): void {
    if (event.key === "F9") {
      event.preventDefault();
      sidebar.toggle();
    } else if (event.key === "Escape" && drawerLayout.current && sidebar.drawerOpen) {
      sidebar.closeDrawer();
    }
  }

  $effect(() => {
    if (toast.matches(":popover-open")) toast.hidePopover();
    if (app.error && !dialogOpen) toast.showPopover();
  });

  function asThemeName(name: string): ThemeName {
    return name === "light" || name === "dark" ? name : "system";
  }

  function changeTheme(name: ThemeName): void {
    theme = name;
    useTheme(name);
  }

  function openDialog(open: () => void): void {
    app.error = "";
    open();
  }

  async function runConfirmed(): Promise<boolean> {
    await confirmRequest.run();
    return app.error === "";
  }

  function askName(request: NameRequest): void {
    nameRequest = request;
    openDialog(() => (nameOpen = true));
  }

  function askMove(request: MoveRequest): void {
    moveRequest = request;
    openDialog(() => (moveOpen = true));
  }

  function askConfirm(request: ConfirmRequest): void {
    confirmRequest = request;
    openDialog(() => (confirmOpen = true));
  }

  function submitName(name: string): Promise<boolean> {
    const request = nameRequest;
    return request.mode === "create" ? app.createFolder(request.parent, name) : app.renameFolder(request.path, name);
  }

  function confirmRemoveVault(descriptor: VaultDescriptor): void {
    askConfirm({
      title: `Retirer « ${descriptor.name} » ?`,
      message: "La copie sur cet appareil est effacée. Les notes restent sur le serveur WebDAV.",
      confirmLabel: "Retirer",
      run: () => app.removeVault(descriptor),
    });
  }

  function confirmEmptyTrash(): void {
    askConfirm({
      title: "Vider la corbeille ?",
      message: "Tous les éléments de la corbeille seront supprimés définitivement.",
      confirmLabel: "Vider",
      run: () => app.emptyTrash(),
    });
  }
</script>

<svelte:window onkeydown={handleKey} />

<kit:app class="shell">
  <div
    class="workspace"
    class:mobile={mobileLayout.current}
    class:drawer={drawerLayout.current}
    class:sidebar-hidden={!drawerLayout.current && !sidebar.open}
    data-pane={app.pane}
  >
    {#if drawerLayout.current && sidebar.drawerOpen}
      <button type="button" class="scrim" aria-label="Fermer les dossiers" onclick={() => sidebar.closeDrawer()}></button>
    {/if}
    <aside class="pane sidebar-pane" class:open={sidebar.drawerOpen} inert={drawerClosed}>
      <Sidebar
        {app}
        {theme}
        {folderActions}
        onconnect={() => openDialog(() => (connectOpen = true))}
        onabout={() => (aboutOpen = true)}
        onremovevault={confirmRemoveVault}
        ontheme={changeTheme}
      />
    </aside>

    <section class="pane list-pane">
      {#if app.scope.kind === "trash" && !app.searching}
        <TrashList {app} controls={listControls} onempty={confirmEmptyTrash} />
      {:else}
        <NoteList {app} controls={listControls} onmove={(path) => askMove({ kind: "note", path })} />
      {/if}
    </section>

    <main class="pane note-pane">
      {#if app.note}
        <NoteView {app} note={app.note} controls={hasWindowControls} onmove={(path) => askMove({ kind: "note", path })} />
      {:else}
        <div class="empty-view">
          <HeaderBar flat controls={hasWindowControls} />
          <div class="placeholder">
            <NotebookPen size={64} strokeWidth={1.25} />
            <h2>Aucune note ouverte</h2>
            <p>Choisissez une note dans la liste ou créez-en une.</p>
            <kit:btn variant="filled" color="accent" rounded="full" onclick={() => app.createNote()}>Nouvelle note</kit:btn>
          </div>
        </div>
      {/if}
    </main>
  </div>

  {#if app.exiting && app.hasRemoteVaults}
    <div class="exit-notice" role="status">
      <span class="exit-spinner" aria-hidden="true"></span>
      <span>Synchronisation avant fermeture… <span class="exit-hint">Fermer à nouveau pour quitter tout de suite.</span></span>
    </div>
  {/if}

  <div class="toast" popover="manual" role="alert" bind:this={toast}>
    <span>{app.error}</span>
    <button type="button" aria-label="Fermer" onclick={() => (app.error = "")}><X size={16} /></button>
  </div>

  <NameDialog
    bind:open={nameOpen}
    title={nameRequest.mode === "create" ? "Nouveau dossier" : "Renommer le dossier"}
    label="Nom du dossier"
    initial={nameRequest.mode === "rename" ? folderLabel(nameRequest.path) : ""}
    confirmLabel={nameRequest.mode === "create" ? "Créer" : "Renommer"}
    error={dialogError}
    onsubmit={submitName}
  />

  <MoveDialog
    bind:open={moveOpen}
    kind={moveRequest.kind}
    path={moveRequest.path}
    vaults={app.vaults}
    current={app.session?.descriptor ?? null}
    loadFolders={(descriptor) => app.foldersOf(descriptor)}
    error={dialogError}
    onmove={(destination) => app.move(moveRequest.kind, moveRequest.path, destination)}
  />

  <ConnectDialog
    bind:open={connectOpen}
    error={dialogError}
    googleDriveAvailable={app.registry.googleDriveAvailable}
    onconnect={(request) => app.connectVault(request)}
    ongooglesignin={() => app.signInToGoogleDrive()}
    ongooglecancel={() => app.cancelGoogleSignIn()}
    ongoogleconnect={(request) => app.connectGoogleDrive(request)}
  />

  <AboutDialog bind:open={aboutOpen} />

  <ConfirmDialog
    bind:open={confirmOpen}
    title={confirmRequest.title}
    message={confirmRequest.message}
    confirmLabel={confirmRequest.confirmLabel}
    error={dialogError}
    onconfirm={runConfirmed}
  />
</kit:app>

<style>
  :global(.shell) {
    display: flex;
    flex-direction: column;
    padding: env(safe-area-inset-top) env(safe-area-inset-right) env(safe-area-inset-bottom) env(safe-area-inset-left);
  }

  .workspace {
    position: relative;
    display: grid;
    flex: 1;
    grid-template-columns: var(--app-sidebar-width) var(--app-list-width) 1fr;
    min-height: 0;
  }

  .pane {
    min-width: 0;
    min-height: 0;
    overflow: hidden;
  }

  .list-pane {
    border-inline-end: 1px solid var(--app-headerbar-shade);
  }

  .workspace.sidebar-hidden {
    grid-template-columns: var(--app-list-width) 1fr;
  }

  .workspace.sidebar-hidden .sidebar-pane {
    display: none;
  }

  .workspace.drawer {
    grid-template-columns: min(var(--app-list-width), 42%) 1fr;
  }

  .workspace.drawer .sidebar-pane {
    position: absolute;
    inset: 0 auto 0 0;
    z-index: 30;
    width: min(85%, var(--app-drawer-width));
    visibility: hidden;
    box-shadow: 0 0 24px var(--app-shadow);
    transform: translateX(-100%);
    transition:
      transform 200ms ease,
      visibility 0s linear 200ms;
  }

  .workspace.drawer .sidebar-pane.open {
    visibility: visible;
    transform: none;
    transition: transform 200ms ease;
  }

  .scrim {
    position: absolute;
    inset: 0;
    z-index: 25;
    padding: 0;
    border: 0;
    background: rgb(0 0 6 / 0.3);
    cursor: default;
    animation: fade-in 200ms ease;
  }

  @keyframes fade-in {
    from {
      opacity: 0;
    }
  }

  @media (prefers-reduced-motion: reduce) {
    .workspace.drawer .sidebar-pane,
    .workspace.drawer .sidebar-pane.open,
    .scrim {
      transition: none;
      animation: none;
    }
  }

  .workspace.mobile {
    grid-template-columns: 1fr;
  }

  .workspace.mobile .list-pane,
  .workspace.mobile .note-pane {
    display: none;
    border: 0;
  }

  .workspace.mobile[data-pane="list"] .list-pane,
  .workspace.mobile[data-pane="note"] .note-pane {
    display: block;
  }

  .workspace.mobile[data-pane="note"]:not(:has(.note-view)) .note-pane {
    display: none;
  }

  .workspace.mobile[data-pane="note"]:not(:has(.note-view)) .list-pane {
    display: block;
  }

  .empty-view {
    display: flex;
    flex-direction: column;
    height: 100%;
    background: var(--app-view-bg);
  }

  .placeholder {
    display: flex;
    flex: 1;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    gap: 6px;
    padding: 24px;
    text-align: center;
    color: var(--app-dim);
  }

  .placeholder h2 {
    margin: 12px 0 0;
    font-size: 1.4rem;
    color: var(--app-fg);
  }

  .placeholder p {
    margin: 0 0 12px;
  }

  .toast {
    inset: auto 0 24px;
    display: none;
    align-items: center;
    gap: 6px;
    width: max-content;
    max-width: min(32rem, calc(100vw - 24px));
    margin-inline: auto;
    padding: 6px 6px 6px 18px;
    border: 0;
    border-radius: 9999px;
    background: var(--app-toast-bg);
    color: var(--app-toast-fg);
    box-shadow: 0 2px 8px var(--app-shadow);
  }

  .exit-notice {
    position: fixed;
    inset: auto 0 24px;
    z-index: 10;
    display: flex;
    align-items: center;
    gap: 12px;
    width: max-content;
    max-width: min(32rem, calc(100vw - 24px));
    margin-inline: auto;
    padding: 10px 18px;
    border-radius: 9999px;
    background: var(--app-toast-bg);
    color: var(--app-toast-fg);
    box-shadow: 0 2px 8px var(--app-shadow);
  }

  .exit-hint {
    opacity: 0.7;
  }

  .exit-spinner {
    flex-shrink: 0;
    width: 16px;
    height: 16px;
    border: 2px solid currentColor;
    border-right-color: transparent;
    border-radius: 50%;
    animation: exit-spin 0.8s linear infinite;
  }

  @keyframes exit-spin {
    to {
      transform: rotate(360deg);
    }
  }

  .toast:popover-open {
    display: flex;
  }

  .toast button {
    display: grid;
    place-items: center;
    width: 32px;
    height: 32px;
    padding: 0;
    border: 0;
    border-radius: 50%;
    background: transparent;
    color: inherit;
    cursor: pointer;
  }

  .toast button:hover {
    background: rgb(255 255 255 / 0.15);
  }
</style>
