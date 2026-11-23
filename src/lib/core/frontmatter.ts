export type FrontmatterValue = string | string[];
export type Frontmatter = Record<string, FrontmatterValue>;

export interface MarkdownDocument {
  frontmatter: Frontmatter;
  body: string;
}

const DELIMITER = "---";
const LIST_ITEM = /^\s*-\s+(.*)$/;

export function parseDocument(source: string): MarkdownDocument {
  const lines = source.replace(/\r\n?/g, "\n").split("\n");
  const closing = lines[0] === DELIMITER ? lines.indexOf(DELIMITER, 1) : -1;

  if (closing === -1) {
    return { frontmatter: {}, body: lines.join("\n") };
  }

  return {
    frontmatter: parseFrontmatter(lines.slice(1, closing)),
    body: lines.slice(closing + 1).join("\n"),
  };
}

export function serializeDocument({ frontmatter, body }: MarkdownDocument): string {
  const lines = Object.entries(frontmatter).map(
    ([key, value]) => `${key}: ${Array.isArray(value) ? `[${value.join(", ")}]` : value}`,
  );

  return [DELIMITER, ...lines, DELIMITER, body].join("\n");
}

function parseFrontmatter(lines: string[]): Frontmatter {
  const frontmatter: Frontmatter = {};
  let currentKey: string | null = null;

  for (const line of lines) {
    const listItem = line.match(LIST_ITEM);

    if (listItem && currentKey) {
      const previous = frontmatter[currentKey];
      frontmatter[currentKey] = [...(Array.isArray(previous) ? previous : []), unquote(listItem[1])];
      continue;
    }

    const separator = line.indexOf(":");

    if (separator <= 0) {
      currentKey = null;
      continue;
    }

    currentKey = line.slice(0, separator).trim();
    frontmatter[currentKey] = parseValue(line.slice(separator + 1).trim());
  }

  return frontmatter;
}

function parseValue(raw: string): FrontmatterValue {
  if (raw.startsWith("[") && raw.endsWith("]")) {
    return raw
      .slice(1, -1)
      .split(",")
      .map(unquote)
      .filter((item) => item.length > 0);
  }

  return unquote(raw);
}

function unquote(raw: string): string {
  const value = raw.trim();
  return /^(["']).*\1$/.test(value) ? value.slice(1, -1) : value;
}
