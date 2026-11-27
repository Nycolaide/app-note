import { MediaQuery } from "svelte/reactivity";

export const mobileLayout = new MediaQuery("(max-width: 639px)");
export const drawerLayout = new MediaQuery("(max-width: 1099px)");
export const touchLayout = new MediaQuery("(pointer: coarse)");

const KEYBOARD_THRESHOLD_PX = 120;
const KEYBOARD_EVENT = "runote:keyboard";

export function onKeyboardToggle(listener: (open: boolean) => void): () => void {
  const handle = (event: Event) => listener((event as CustomEvent<boolean>).detail);
  window.addEventListener(KEYBOARD_EVENT, handle);
  return () => window.removeEventListener(KEYBOARD_EVENT, handle);
}

export function fitToVisualViewport() {
  const viewport = window.visualViewport;
  if (!viewport) return;

  const root = document.documentElement;
  let keyboardWasOpen = false;

  const sync = () => {
    if (viewport.scale > 1) return;
    root.style.setProperty("--app-viewport-height", `${viewport.height}px`);
    root.style.setProperty("--app-viewport-top", `${viewport.offsetTop}px`);
    const keyboardOpen = window.innerHeight - viewport.height > KEYBOARD_THRESHOLD_PX;
    root.toggleAttribute("data-keyboard-open", keyboardOpen);
    if (window.scrollY !== 0) window.scrollTo(0, 0);
    if (keyboardOpen !== keyboardWasOpen) window.dispatchEvent(new CustomEvent(KEYBOARD_EVENT, { detail: keyboardOpen }));
    keyboardWasOpen = keyboardOpen;
  };

  viewport.addEventListener("resize", sync);
  viewport.addEventListener("scroll", sync);
  sync();
}
