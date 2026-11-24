const PREFIX = "attachments/";
const TERMINATOR = `(?=[\\s)"'<>\\]]|$)`;
const REFERENCE_PATTERNS = [/\(<attachments\/([^>]+)>/g, /attachments\/([^\s)"'<>\]]+)/g];

export function attachmentReferences(content: string): Set<string> {
  const names = new Set<string>();

  for (const pattern of REFERENCE_PATTERNS) {
    for (const [, name] of content.matchAll(pattern)) names.add(decodeName(name));
  }

  return names;
}

export function replaceAttachmentReference(content: string, from: string, to: string): string {
  return [...new Set([from, encodeURI(from)])].reduce(
    (result, variant) => result.replace(new RegExp(`${escapeRegExp(PREFIX + variant)}${TERMINATOR}`, "g"), PREFIX + to),
    content,
  );
}

function decodeName(name: string): string {
  try {
    return decodeURIComponent(name);
  } catch {
    return name;
  }
}

function escapeRegExp(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
