import { getCurrentWindow } from "@tauri-apps/api/window";

const userAgent = navigator.userAgent;
const isMobile = /android|iphone|ipad/i.test(userAgent);

export const hasWindowControls = !isMobile;

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
