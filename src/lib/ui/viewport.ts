import { MediaQuery } from "svelte/reactivity";

export const mobileLayout = new MediaQuery("(max-width: 639px)");
export const drawerLayout = new MediaQuery("(max-width: 1099px)");

const KEYBOARD_THRESHOLD_PX = 120;

function revealCaret() {
  const focused = document.activeElement;
  if (!(focused instanceof HTMLElement) || !focused.isContentEditable) return;
  const caretNode = window.getSelection()?.focusNode;
  const caretElement = caretNode instanceof Element ? caretNode : caretNode?.parentElement;
  caretElement?.scrollIntoView({ block: "nearest" });
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
    if (keyboardOpen && !keyboardWasOpen) requestAnimationFrame(revealCaret);
    keyboardWasOpen = keyboardOpen;
  };

  viewport.addEventListener("resize", sync);
  viewport.addEventListener("scroll", sync);
  sync();
}
