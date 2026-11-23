import { parseDocument, serializeDocument, type Frontmatter } from "./frontmatter";
import { baseName, sanitizeName } from "./path";

export interface NoteMeta {
  id: string;
  path: string;
  title: string;
  tags: string[];
  created: string;
  updated: string;
}

export interface Note extends NoteMeta {
  content: string;
  properties: Frontmatter;
}

const NOTE_EXTENSION = ".md";
const RESERVED_KEYS = ["id", "tags", "created", "updated"];

export function isNoteFile(name: string): boolean {
  return name.toLowerCase().endsWith(NOTE_EXTENSION);
}

export function noteFileName(title: string): string {
  return `${sanitizeName(title)}${NOTE_EXTENSION}`;
}

export function titleFromPath(path: string): string {
  return baseName(path).slice(0, -NOTE_EXTENSION.length);
}

export function normalizeTags(tags: string[]): string[] {
  const unique = new Map<string, string>();

  for (const raw of tags) {
    const tag = raw
      .trim()
      .replace(/^#+/, "")
      .replace(/[\s,[\]"']+/g, "-");

    if (tag.length > 0 && !unique.has(tag.toLowerCase())) {
      unique.set(tag.toLowerCase(), tag);
    }
  }

  return [...unique.values()];
}

export function parseNote(path: string, source: string): Note {
  const { frontmatter, body } = parseDocument(source);
  const now = new Date().toISOString();
  const tags = frontmatter.tags;

  return {
    id: asString(frontmatter.id) ?? crypto.randomUUID(),
    path,
    title: titleFromPath(path),
    tags: normalizeTags(Array.isArray(tags) ? tags : tags ? [tags] : []),
    created: asString(frontmatter.created) ?? now,
    updated: asString(frontmatter.updated) ?? now,
    content: body,
    properties: Object.fromEntries(
      Object.entries(frontmatter).filter(([key]) => !RESERVED_KEYS.includes(key)),
    ),
  };
}

export function serializeNote(note: Note): string {
  return serializeDocument({
    frontmatter: {
      id: note.id,
      tags: note.tags,
      created: note.created,
      updated: note.updated,
      ...note.properties,
    },
    body: note.content,
  });
}

export function toMeta({ id, path, title, tags, created, updated }: Note): NoteMeta {
  return { id, path, title, tags, created, updated };
}

function asString(value: unknown): string | undefined {
  return typeof value === "string" && value.length > 0 ? value : undefined;
}
