const SEPARATOR = "/";
const MAX_NAME_LENGTH = 200;
const FORBIDDEN_CHARACTERS = /[<>:"/\\|?*\u0000-\u001f]/g;
const EDGE_DOTS_AND_SPACES = /^[.\s]+|[.\s]+$/g;
const RESERVED_WINDOWS_NAMES = /^(con|prn|aux|nul|com\d|lpt\d)(\..*)?$/i;

export function joinPath(...parts: string[]): string {
  return parts
    .flatMap((part) => part.split(SEPARATOR))
    .filter((segment) => segment.length > 0)
    .join(SEPARATOR);
}

export function parentPath(path: string): string {
  const index = path.lastIndexOf(SEPARATOR);
  return index === -1 ? "" : path.slice(0, index);
}

export function baseName(path: string): string {
  return path.slice(path.lastIndexOf(SEPARATOR) + 1);
}

export function isSameOrInside(path: string, ancestor: string): boolean {
  return ancestor === "" || path === ancestor || path.startsWith(ancestor + SEPARATOR);
}

export function replacePrefix(path: string, from: string, to: string): string {
  return joinPath(to, path.slice(from.length));
}

export function samePath(a: string, b: string): boolean {
  return a.localeCompare(b, undefined, { sensitivity: "accent" }) === 0;
}

export function sanitizeName(name: string): string {
  const cleaned = name
    .replace(FORBIDDEN_CHARACTERS, "-")
    .slice(0, MAX_NAME_LENGTH)
    .replace(EDGE_DOTS_AND_SPACES, "");

  if (cleaned.length === 0) {
    throw new Error(`Nom invalide : "${name}"`);
  }

  return RESERVED_WINDOWS_NAMES.test(cleaned) ? `${cleaned}_` : cleaned;
}
