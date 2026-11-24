import { listItemSchema } from "@milkdown/kit/preset/commonmark";
import type { Node } from "@milkdown/kit/prose/model";
import { splitListItem, wrapInList } from "@milkdown/kit/prose/schema-list";
import type { Transaction } from "@milkdown/kit/prose/state";
import type { EditorView, NodeViewConstructor } from "@milkdown/kit/prose/view";
import { $view } from "@milkdown/kit/utils";

const LIST_ITEM = "list_item";
const BULLET_LIST = "bullet_list";

export const taskItemView = $view(listItemSchema.node, (): NodeViewConstructor => (initial, view, getPos) => {
  const dom = document.createElement("li");
  let node = initial;

  writeListAttributes(dom, node);

  if (!isTask(node)) {
    return {
      dom,
      contentDOM: dom,
      update(next) {
        if (next.type !== initial.type || isTask(next)) return false;
        node = next;
        writeListAttributes(dom, next);
        return true;
      },
    };
  }

  const checkbox = document.createElement("span");
  checkbox.className = "task-checkbox";
  checkbox.contentEditable = "false";
  checkbox.setAttribute("role", "checkbox");
  checkbox.tabIndex = -1;

  const contentDOM = document.createElement("div");
  contentDOM.className = "task-content";
  dom.append(checkbox, contentDOM);

  const render = () => {
    writeListAttributes(dom, node);
    checkbox.setAttribute("aria-checked", String(node.attrs.checked === true));
    checkbox.setAttribute("aria-label", node.attrs.checked ? "Décocher" : "Cocher");
  };

  checkbox.addEventListener("mousedown", (event) => event.preventDefault());
  checkbox.addEventListener("click", (event) => {
    event.preventDefault();
    const position = getPos();
    if (position === undefined || !view.editable) return;
    view.dispatch(view.state.tr.setNodeMarkup(position, undefined, { ...node.attrs, checked: !node.attrs.checked }));
  });

  render();

  return {
    dom,
    contentDOM,
    update(next) {
      if (next.type !== initial.type || !isTask(next)) return false;
      node = next;
      render();
      return true;
    },
    stopEvent: (event) => event.target === checkbox,
    ignoreMutation: (mutation) => !contentDOM.contains(mutation.target),
  };
});

export function toggleTaskList(view: EditorView): void {
  const { state } = view;
  const { from, to } = state.selection;
  const items = listItemsBetween(state.doc, from, to);

  if (items.length > 0) {
    const removeTasks = items.every(({ node }) => isTask(node));
    const tr = state.tr;
    for (const { node, position } of items) {
      tr.setNodeMarkup(position, undefined, { ...node.attrs, checked: removeTasks ? null : (node.attrs.checked ?? false) });
    }
    view.dispatch(tr);
    return;
  }

  wrapInList(state.schema.nodes[BULLET_LIST])(state, (tr: Transaction) => {
    for (const { node, position } of listItemsBetween(tr.doc, tr.mapping.map(from), tr.mapping.map(to))) {
      if (!isTask(node)) tr.setNodeMarkup(position, undefined, { ...node.attrs, checked: false });
    }
    view.dispatch(tr);
  });
}

export function continueTaskList(view: EditorView, event: KeyboardEvent): boolean {
  if (event.key !== "Enter" || event.shiftKey || event.ctrlKey || event.metaKey || event.altKey) return false;

  const { $from } = view.state.selection;
  for (let depth = $from.depth; depth > 0; depth--) {
    const item = $from.node(depth);
    if (item.type.name !== LIST_ITEM) continue;
    if (!isTask(item) || item.textContent === "") return false;
    return splitListItem(item.type, { ...item.attrs, checked: false })(view.state, view.dispatch);
  }

  return false;
}

function isTask(node: Node): boolean {
  return node.attrs.checked !== null && node.attrs.checked !== undefined;
}

function listItemsBetween(doc: Node, from: number, to: number): { node: Node; position: number }[] {
  const items: { node: Node; position: number }[] = [];
  doc.nodesBetween(from, to, (node, position) => {
    if (node.type.name !== LIST_ITEM || !node.firstChild) return;
    const ownTextStart = position + 1;
    const ownTextEnd = ownTextStart + node.firstChild.nodeSize;
    if (from <= ownTextEnd && to >= ownTextStart) items.push({ node, position });
  });
  return items;
}

function writeListAttributes(dom: HTMLElement, node: Node): void {
  dom.dataset.label = String(node.attrs.label ?? "");
  dom.dataset.listType = String(node.attrs.listType ?? "");
  dom.dataset.spread = String(node.attrs.spread ?? "");
  if (isTask(node)) {
    dom.dataset.itemType = "task";
    dom.dataset.checked = String(node.attrs.checked);
  }
}
