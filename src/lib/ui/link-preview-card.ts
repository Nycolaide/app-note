import type { LinkPreview } from "$lib/core";

export function createLinkPreviewCard(
  url: string,
  load: (url: string) => Promise<LinkPreview | null>,
  open: (url: string) => void,
): HTMLElement {
  const card = document.createElement("div");
  card.className = "link-preview";
  card.contentEditable = "false";
  card.dataset.state = "loading";
  card.textContent = "Chargement de l'aperçu…";
  card.addEventListener("click", () => open(url));

  load(url).then((preview) => {
    card.replaceChildren(...(preview ? previewContent(preview) : [text("span", url)]));
    card.dataset.state = preview ? "ready" : "error";
  });

  return card;
}

function previewContent(preview: LinkPreview): HTMLElement[] {
  const elements: HTMLElement[] = [];

  if (preview.image) {
    const image = document.createElement("img");
    image.src = preview.image;
    image.alt = "";
    image.loading = "lazy";
    image.addEventListener("error", () => image.remove());
    elements.push(image);
  }

  elements.push(text("strong", preview.title));

  if (preview.description) {
    elements.push(text("p", preview.description));
  }

  elements.push(text("small", preview.siteName));
  return elements;
}

function text<K extends keyof HTMLElementTagNameMap>(tag: K, content: string): HTMLElementTagNameMap[K] {
  const element = document.createElement(tag);
  element.textContent = content;
  return element;
}
