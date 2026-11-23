import { $prose } from "@milkdown/kit/utils";
import { Plugin, PluginKey } from "@milkdown/kit/prose/state";
import { Decoration, DecorationSet } from "@milkdown/kit/prose/view";
import type { Node } from "@milkdown/kit/prose/model";

export type LinkPreviewRenderer = (url: string) => HTMLElement;

const WEB_URL = /^https?:\/\//i;

export function linkPreviewPlugin(render: LinkPreviewRenderer) {
  return $prose(
    () =>
      new Plugin<DecorationSet>({
        key: new PluginKey("link-preview"),
        state: {
          init: (_, state) => buildDecorations(state.doc, render),
          apply: (transaction, previous) =>
            transaction.docChanged ? buildDecorations(transaction.doc, render) : previous,
        },
        props: {
          decorations(state) {
            return this.getState(state);
          },
        },
      }),
  );
}

function buildDecorations(doc: Node, render: LinkPreviewRenderer): DecorationSet {
  const decorations: Decoration[] = [];
  const occurrences = new Map<string, number>();

  doc.forEach((node, offset) => {
    const url = standaloneUrl(node);
    if (!url) return;

    const occurrence = occurrences.get(url) ?? 0;
    occurrences.set(url, occurrence + 1);

    decorations.push(
      Decoration.widget(offset + node.nodeSize, () => render(url), {
        key: `link-preview:${occurrence}:${url}`,
        side: 1,
        ignoreSelection: true,
        stopEvent: () => true,
      }),
    );
  });

  return DecorationSet.create(doc, decorations);
}

function standaloneUrl(node: Node): string | null {
  if (node.type.name !== "paragraph" || node.childCount !== 1) return null;

  const child = node.firstChild;
  const link = child?.isText ? child.marks.find((mark) => mark.type.name === "link") : undefined;
  const href = String(link?.attrs.href ?? "");

  if (!child?.text || !WEB_URL.test(href)) return null;

  return withoutProtocol(href) === withoutProtocol(child.text) ? href : null;
}

function withoutProtocol(url: string): string {
  return url.replace(WEB_URL, "").replace(/\/$/, "");
}
