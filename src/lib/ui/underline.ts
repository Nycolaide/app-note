import { commandsCtx } from "@milkdown/kit/core";
import { toggleMark } from "@milkdown/kit/prose/commands";
import { $command, $markSchema, $remark, $useKeymap } from "@milkdown/kit/utils";

const UNDERLINE = "underline";
const OPEN_TAG = /^<u>$/i;
const CLOSE_TAG = /^<\/u>$/i;

interface MarkdownNode {
  type: string;
  value?: string;
  children?: MarkdownNode[];
}

interface PhrasingState {
  containerPhrasing(node: MarkdownNode, info: object): string;
}

const isTag = (node: MarkdownNode, tag: RegExp) => node.type === "html" && tag.test(node.value?.trim() ?? "");

function groupUnderlines(node: MarkdownNode): void {
  if (!node.children) return;
  node.children.forEach(groupUnderlines);

  const grouped: MarkdownNode[] = [];
  let openTag: MarkdownNode | undefined;
  let underlined: MarkdownNode[] = [];

  for (const child of node.children) {
    if (!openTag && isTag(child, OPEN_TAG)) {
      openTag = child;
      underlined = [];
    } else if (openTag && isTag(child, CLOSE_TAG)) {
      grouped.push({ type: UNDERLINE, children: underlined });
      openTag = undefined;
    } else if (openTag) {
      underlined.push(child);
    } else {
      grouped.push(child);
    }
  }

  if (openTag) grouped.push(openTag, ...underlined);
  node.children = grouped;
}

const remarkUnderline = $remark("remarkUnderline", () =>
  function (this: { data(): object }) {
    const data = this.data() as { toMarkdownExtensions?: object[] };
    const extensions = (data.toMarkdownExtensions ??= []) as object[];
    extensions.push({
      handlers: {
        [UNDERLINE]: (node: MarkdownNode, _parent: unknown, state: PhrasingState, info: object) =>
          `<u>${state.containerPhrasing(node, { ...info, before: ">", after: "<" })}</u>`,
      },
    });
    return (tree: MarkdownNode) => groupUnderlines(tree);
  },
);

export const underlineSchema = $markSchema(UNDERLINE, () => ({
  parseDOM: [{ tag: "u" }],
  toDOM: () => ["u", 0],
  parseMarkdown: {
    match: (node) => node.type === UNDERLINE,
    runner: (state, node, markType) => {
      state.openMark(markType);
      state.next(node.children);
      state.closeMark(markType);
    },
  },
  toMarkdown: {
    match: (mark) => mark.type.name === UNDERLINE,
    runner: (state, mark) => {
      state.withMark(mark, UNDERLINE);
    },
  },
}));

export const toggleUnderlineCommand = $command("ToggleUnderline", (ctx) => () => toggleMark(underlineSchema.type(ctx)));

const underlineKeymap = $useKeymap("underlineKeymap", {
  ToggleUnderline: {
    shortcuts: ["Mod-u"],
    command: (ctx) => {
      const commands = ctx.get(commandsCtx);
      return () => commands.call(toggleUnderlineCommand.key);
    },
  },
});

export const underline = [remarkUnderline, underlineSchema, toggleUnderlineCommand, underlineKeymap].flat();
