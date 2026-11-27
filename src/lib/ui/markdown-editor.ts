import {
  Editor,
  defaultValueCtx,
  editorViewCtx,
  editorViewOptionsCtx,
  remarkStringifyOptionsCtx,
  rootCtx,
} from "@milkdown/kit/core";
import {
  commonmark,
  createCodeBlockCommand,
  imageSchema,
  insertHrCommand,
  insertImageCommand,
  liftListItemCommand,
  sinkListItemCommand,
  toggleEmphasisCommand,
  toggleInlineCodeCommand,
  toggleStrongCommand,
  turnIntoTextCommand,
  wrapInBlockquoteCommand,
  wrapInBulletListCommand,
  wrapInHeadingCommand,
  wrapInOrderedListCommand,
} from "@milkdown/kit/preset/commonmark";
import { gfm, insertTableCommand, toggleStrikethroughCommand } from "@milkdown/kit/preset/gfm";
import { history, undoCommand } from "@milkdown/kit/plugin/history";
import { clipboard } from "@milkdown/kit/plugin/clipboard";
import { listener, listenerCtx } from "@milkdown/kit/plugin/listener";
import { upload, uploadConfig, type Uploader } from "@milkdown/kit/plugin/upload";
import { $prose, $view, callCommand } from "@milkdown/kit/utils";
import type { Node } from "@milkdown/kit/prose/model";
import { Plugin, Selection, type EditorState } from "@milkdown/kit/prose/state";
import type { NodeViewConstructor } from "@milkdown/kit/prose/view";
import { linkPreviewPlugin, type LinkPreviewRenderer } from "./link-preview-plugin";
import { continueTaskList, taskItemView, toggleTaskList } from "./task-list";
import { toggleUnderlineCommand, underline } from "./underline";

export interface MarkdownEditorOptions {
  root: HTMLElement;
  value: string;
  onChange: (markdown: string) => void;
  resolveImage: (source: string) => Promise<string>;
  saveImage: (file: File) => Promise<string>;
  renderLinkPreview: LinkPreviewRenderer;
  onActiveFormatsChange?: (active: ReadonlySet<FormatCommand>) => void;
}

export type FormatCommand =
  | "bold"
  | "italic"
  | "underline"
  | "strike"
  | "code"
  | "paragraph"
  | "heading1"
  | "heading2"
  | "heading3"
  | "bulletList"
  | "orderedList"
  | "taskList"
  | "quote"
  | "codeBlock"
  | "rule"
  | "indent"
  | "outdent";

export interface MarkdownEditor {
  format(command: FormatCommand): void;
  insertTable(): void;
  insertImage(source: string, alt: string): void;
  undo(): void;
  focus(): void;
  focusEnd(): void;
  revealCursor(): void;
  destroy(): Promise<void>;
}

const DEFAULT_TABLE_SIZE = { row: 3, col: 3 };
const CURSOR_SCROLL_MARGIN = { top: 24, bottom: 96, left: 0, right: 0 };

const MARK_FORMATS: [string, FormatCommand][] = [
  ["strong", "bold"],
  ["emphasis", "italic"],
  ["underline", "underline"],
  ["strike_through", "strike"],
  ["inlineCode", "code"],
];

const HEADING_FORMATS: Record<number, FormatCommand> = { 1: "heading1", 2: "heading2", 3: "heading3" };

function readActiveFormats(state: EditorState): Set<FormatCommand> {
  const active = new Set<FormatCommand>();
  const { $from, from, to, empty } = state.selection;
  const cursorMarks = state.storedMarks ?? $from.marks();

  for (const [markName, format] of MARK_FORMATS) {
    const markType = state.schema.marks[markName];
    if (!markType) continue;
    const present = empty ? markType.isInSet(cursorMarks) : state.doc.rangeHasMark(from, to, markType);
    if (present) active.add(format);
  }

  const block = $from.parent;
  if (block.type.name === "heading") {
    const heading = HEADING_FORMATS[Number(block.attrs.level)];
    if (heading) active.add(heading);
  } else if (block.type.name === "code_block") {
    active.add("codeBlock");
  } else if (block.type.name === "paragraph") {
    active.add("paragraph");
  }

  for (let depth = $from.depth; depth > 0; depth--) {
    const ancestor = $from.node(depth);
    if (ancestor.type.name === "blockquote") active.add("quote");
    if (ancestor.type.name === "ordered_list") {
      active.add("orderedList");
      break;
    }
    if (ancestor.type.name === "bullet_list") {
      const item = $from.node(depth + 1);
      active.add(item.attrs.checked == null ? "bulletList" : "taskList");
      break;
    }
  }

  return active;
}

function activeFormatsTracker(onChange: (active: ReadonlySet<FormatCommand>) => void) {
  return $prose(
    () =>
      new Plugin({
        view: (view) => {
          onChange(readActiveFormats(view.state));
          return { update: (updated) => onChange(readActiveFormats(updated.state)) };
        },
      }),
  );
}

export async function createMarkdownEditor(options: MarkdownEditorOptions): Promise<MarkdownEditor> {
  const editor = await Editor.make()
    .config((ctx) => {
      ctx.set(rootCtx, options.root);
      ctx.set(defaultValueCtx, options.value);
      ctx.update(remarkStringifyOptionsCtx, (current) => ({
        ...current,
        bullet: "-" as const,
        rule: "-" as const,
      }));
      ctx.update(uploadConfig.key, (current) => ({
        ...current,
        uploader: createUploader(options.saveImage),
        enableHtmlFileUploader: false,
      }));
      ctx.update(editorViewOptionsCtx, (current) => ({
        ...current,
        scrollMargin: CURSOR_SCROLL_MARGIN,
        scrollThreshold: CURSOR_SCROLL_MARGIN,
        handleKeyDown: (view, event) => continueTaskList(view, event) || current.handleKeyDown?.(view, event) || false,
      }));
      ctx.get(listenerCtx).markdownUpdated((_, markdown, previous) => {
        if (markdown !== previous) options.onChange(markdown);
      });
    })
    .use(commonmark)
    .use(gfm)
    .use(history)
    .use(clipboard)
    .use(listener)
    .use(upload)
    .use(createImageView(options.resolveImage))
    .use(taskItemView)
    .use(underline)
    .use(activeFormatsTracker((active) => options.onActiveFormatsChange?.(active)))
    .use(linkPreviewPlugin(options.renderLinkPreview))
    .create();

  const formats: Record<FormatCommand, () => void> = {
    bold: () => editor.action(callCommand(toggleStrongCommand.key)),
    italic: () => editor.action(callCommand(toggleEmphasisCommand.key)),
    underline: () => editor.action(callCommand(toggleUnderlineCommand.key)),
    strike: () => editor.action(callCommand(toggleStrikethroughCommand.key)),
    code: () => editor.action(callCommand(toggleInlineCodeCommand.key)),
    paragraph: () => editor.action(callCommand(turnIntoTextCommand.key)),
    heading1: () => editor.action(callCommand(wrapInHeadingCommand.key, 1)),
    heading2: () => editor.action(callCommand(wrapInHeadingCommand.key, 2)),
    heading3: () => editor.action(callCommand(wrapInHeadingCommand.key, 3)),
    bulletList: () => editor.action(callCommand(wrapInBulletListCommand.key)),
    orderedList: () => editor.action(callCommand(wrapInOrderedListCommand.key)),
    taskList: () => editor.action((ctx) => toggleTaskList(ctx.get(editorViewCtx))),
    quote: () => editor.action(callCommand(wrapInBlockquoteCommand.key)),
    codeBlock: () => editor.action(callCommand(createCodeBlockCommand.key)),
    rule: () => editor.action(callCommand(insertHrCommand.key)),
    indent: () => editor.action(callCommand(sinkListItemCommand.key)),
    outdent: () => editor.action(callCommand(liftListItemCommand.key)),
  };

  return {
    format: (command) => formats[command](),
    insertTable: () => editor.action(callCommand(insertTableCommand.key, DEFAULT_TABLE_SIZE)),
    insertImage: (src, alt) => editor.action(callCommand(insertImageCommand.key, { src, alt })),
    undo: () => editor.action(callCommand(undoCommand.key)),
    focus: () => editor.action((ctx) => ctx.get(editorViewCtx).focus()),
    focusEnd: () =>
      editor.action((ctx) => {
        const view = ctx.get(editorViewCtx);
        view.dispatch(view.state.tr.setSelection(Selection.atEnd(view.state.doc)).scrollIntoView());
        view.focus();
      }),
    revealCursor: () =>
      editor.action((ctx) => {
        const view = ctx.get(editorViewCtx);
        view.dispatch(view.state.tr.scrollIntoView());
      }),
    destroy: async () => {
      await editor.destroy();
    },
  };
}

function createUploader(saveImage: (file: File) => Promise<string>): Uploader {
  return async (files, schema) => {
    const images = Array.from(files).filter((file) => file.type.startsWith("image/"));

    const nodes = await Promise.all(
      images.map(async (file) => schema.nodes.image.createAndFill({ src: await saveImage(file), alt: file.name })),
    );

    return nodes.filter((node): node is Node => node !== null);
  };
}

type ImageState = "loading" | "ready" | "error";

const IMAGE_STATUS: Record<ImageState, string> = {
  loading: "Chargement de l’image…",
  ready: "",
  error: "Image introuvable",
};

function createImageView(resolveImage: (source: string) => Promise<string>) {
  return $view(imageSchema.node, (): NodeViewConstructor => (initial) => {
    const dom = document.createElement("span");
    const image = document.createElement("img");
    const status = document.createElement("span");
    dom.className = "image-frame";
    status.className = "image-status";
    dom.append(image, status);

    let current = initial;
    let source: string | undefined;

    const setState = (state: ImageState) => {
      dom.dataset.state = state;
      dom.setAttribute("aria-busy", String(state === "loading"));
      status.textContent = IMAGE_STATUS[state];
    };

    image.addEventListener("load", () => setState("ready"));
    image.addEventListener("error", () => setState("error"));

    const render = (node: Node) => {
      image.alt = String(node.attrs.alt ?? "");
      image.title = String(node.attrs.title ?? "");

      const nextSource = String(node.attrs.src ?? "");
      if (nextSource === source) return;
      source = nextSource;

      setState("loading");
      image.removeAttribute("src");
      resolveImage(nextSource).then((url) => {
        if (current !== node) return;
        if (url) image.src = url;
        else setState("error");
      });
    };

    render(initial);

    return {
      dom,
      update(node) {
        if (node.type !== initial.type) return false;
        current = node;
        render(node);
        return true;
      },
    };
  });
}
