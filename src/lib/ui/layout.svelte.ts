import { drawerLayout } from "./viewport";

const SIDEBAR_KEY = "runote:sidebar-open";

class SidebarState {
  open = $state(readOpen());
  drawerOpen = $state(false);

  toggle(): void {
    if (drawerLayout.current) {
      this.drawerOpen = !this.drawerOpen;
      return;
    }

    this.open = !this.open;
    try {
      localStorage.setItem(SIDEBAR_KEY, String(this.open));
    } catch {
      return;
    }
  }

  closeDrawer(): void {
    this.drawerOpen = false;
  }
}

function readOpen(): boolean {
  try {
    return localStorage.getItem(SIDEBAR_KEY) !== "false";
  } catch {
    return true;
  }
}

export const sidebar = new SidebarState();
