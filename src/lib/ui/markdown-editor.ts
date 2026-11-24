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
import { history } from "@milkdown/kit/plugin/history";
import { clipboard } from "@milkdown/kit/plugin/clipboard";
import { listener, listenerCtx } from "@milkdown/kit/plugin/listener";
import { upload, uploadConfig, type Uploader } from "@milkdown/kit/plugin/upload";
import { $view, callCommand } from "@milkdown/kit/utils";
import type { Node } from "@milkdown/kit/prose/model";
import type { NodeViewConstructor } from "@milkdown/kit/prose/view";
import { linkPreviewPlugin, type LinkPreviewRenderer } from "./link-preview-plugin";
import { continueTaskList, taskItemView, toggleTaskList } from "./task-list";

export interface MarkdownEditorOptions {
  root: HTMLElement;
  value: string;
  onChange: (markdown: string) => void;
  resolveImage: (source: string) => Promise<string>;
  saveImage: (file: File) => Promise<string>;
  renderLinkPreview: LinkPreviewRenderer;
}

export type FormatCommand =
  | "bold"
  | "italic"
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
  | "rule";

export interface MarkdownEditor {
  format(command: FormatCommand): void;
  insertTable(): void;
  insertImage(source: string, alt: string): void;
  destroy(): Promise<void>;
}

const DEFAULT_TABLE_SIZE = { row: 3, col: 3 };

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
    .use(linkPreviewPlugin(options.renderLinkPreview))
    .create();

  const formats: Record<FormatCommand, () => void> = {
    bold: () => editor.action(callCommand(toggleStrongCommand.key)),
    italic: () => editor.action(callCommand(toggleEmphasisCommand.key)),
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
  };

  return {
    format: (command) => formats[command](),
    insertTable: () => editor.action(callCommand(insertTableCommand.key, DEFAULT_TABLE_SIZE)),
    insertImage: (src, alt) => editor.action(callCommand(insertImageCommand.key, { src, alt })),
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

function createImageView(resolveImage: (source: string) => Promise<string>) {
  return $view(imageSchema.node, (): NodeViewConstructor => (initial) => {
    const dom = document.createElement("img");
    let current = initial;

    const render = (node: Node) => {
      dom.alt = String(node.attrs.alt ?? "");
      dom.title = String(node.attrs.title ?? "");
      resolveImage(String(node.attrs.src ?? "")).then((url) => {
        if (current === node) dom.src = url;
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
