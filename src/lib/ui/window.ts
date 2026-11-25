import { getCurrentWindow } from "@tauri-apps/api/window";

const userAgent = navigator.userAgent;
const isMobile = /android|iphone|ipad/i.test(userAgent);

export const hasWindowControls = !isMobile;

export interface AppVisibilityHandlers {
  onBackground: () => Promise<void>;
  onForeground: () => void;
}

export function watchMobileAppVisibility({ onBackground, onForeground }: AppVisibilityHandlers): () => void {
  if (!isMobile) return () => undefined;
  const handleVisibility = () => {
    if (document.visibilityState === "hidden") onBackground().catch(() => undefined);
    else onForeground();
  };
  document.addEventListener("visibilitychange", handleVisibility);
  return () => document.removeEventListener("visibilitychange", handleVisibility);
}

export async function beforeWindowClose(task: () => Promise<void>): Promise<() => void> {
  if (isMobile) return () => undefined;
  return getCurrentWindow().onCloseRequested(() => task().catch(() => undefined));
}

export async function trackWindowFrame(root: HTMLElement): Promise<() => void> {
  if (isMobile) return () => undefined;

  root.dataset.windowFrame = /linux/i.test(userAgent) ? "rounded" : "native";
  const appWindow = getCurrentWindow();

  const update = async () => {
    const [maximized, fullscreen] = await Promise.all([appWindow.isMaximized(), appWindow.isFullscreen()]);
    root.dataset.windowState = maximized || fullscreen ? "maximized" : "normal";
  };

  await update();
  return appWindow.onResized(update);
}
