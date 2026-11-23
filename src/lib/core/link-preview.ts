import { defaultFetcher, type Fetcher } from "./http";

export interface LinkPreview {
  url: string;
  title: string;
  description: string;
  image: string;
  siteName: string;
}


export interface LinkPreviews {
  get(url: string): Promise<LinkPreview | null>;
}

const TIMEOUT_MS = 8000;
const MAX_BYTES = 512 * 1024;
const MAX_DESCRIPTION_LENGTH = 300;
const HEAD_END = /<\/head\s*>/i;
const WEB_URL = /^https?:\/\//i;

const TITLE_KEYS = ["og:title", "twitter:title"];
const DESCRIPTION_KEYS = ["og:description", "twitter:description", "description"];
const IMAGE_KEYS = ["og:image", "og:image:url", "og:image:secure_url", "twitter:image", "twitter:image:src"];
const SITE_NAME_KEYS = ["og:site_name", "application-name"];

export function isWebUrl(url: string): boolean {
  return WEB_URL.test(url);
}

export function createLinkPreviews(fetcher: Fetcher = defaultFetcher): LinkPreviews {
  const cache = new Map<string, Promise<LinkPreview | null>>();

  async function load(url: string): Promise<LinkPreview | null> {
    const response = await fetcher(url, {
      signal: AbortSignal.timeout(TIMEOUT_MS),
      headers: { Accept: "text/html,application/xhtml+xml" },
    });

    if (!response.ok) {
      await response.body?.cancel();
      return null;
    }

    const finalUrl = response.url || url;
    const contentType = response.headers.get("content-type") ?? "";

    if (contentType.startsWith("image/")) {
      await response.body?.cancel();
      return { url, title: hostnameOf(finalUrl), description: "", image: finalUrl, siteName: hostnameOf(finalUrl) };
    }

    if (!contentType.includes("html")) {
      await response.body?.cancel();
      return null;
    }

    const html = await readHead(response, charsetOf(contentType));
    return { ...parseLinkPreview(html, finalUrl), url };
  }

  return {
    get(url) {
      if (!isWebUrl(url)) return Promise.resolve(null);

      let preview = cache.get(url);

      if (!preview) {
        preview = load(url).catch(() => {
          cache.delete(url);
          return null;
        });
        cache.set(url, preview);
      }

      return preview;
    },
  };
}

export function parseLinkPreview(html: string, url: string): LinkPreview {
  const document = new DOMParser().parseFromString(html, "text/html");

  const values = new Map<string, string>();

  for (const element of document.querySelectorAll("meta[content]")) {
    const key = (element.getAttribute("property") ?? element.getAttribute("name") ?? "").toLowerCase();
    const content = element.getAttribute("content")?.trim() ?? "";
    if (key && content && !values.has(key)) values.set(key, content);
  }

  const meta = (keys: string[]): string => keys.map((key) => values.get(key)).find(Boolean) ?? "";

  const siteName = meta(SITE_NAME_KEYS) || hostnameOf(url);

  return {
    url,
    title: meta(TITLE_KEYS) || document.title.trim() || siteName,
    description: truncate(meta(DESCRIPTION_KEYS), MAX_DESCRIPTION_LENGTH),
    image: absoluteWebUrl(meta(IMAGE_KEYS), url),
    siteName,
  };
}

async function readHead(response: Response, charset: string): Promise<string> {
  if (!response.body) {
    return (await response.text()).slice(0, MAX_BYTES);
  }

  const reader = response.body.getReader();
  const decoder = createDecoder(charset);
  let html = "";
  let received = 0;

  while (received < MAX_BYTES) {
    const { done, value } = await reader.read();
    if (done) break;
    received += value.byteLength;
    html += decoder.decode(value, { stream: true });
    if (HEAD_END.test(html)) break;
  }

  await reader.cancel().catch(() => undefined);
  return html;
}

function createDecoder(charset: string): TextDecoder {
  try {
    return new TextDecoder(charset);
  } catch {
    return new TextDecoder("utf-8");
  }
}

function charsetOf(contentType: string): string {
  return contentType.match(/charset=["']?([\w-]+)/i)?.[1] ?? "utf-8";
}

function absoluteWebUrl(value: string, base: string): string {
  if (!value) return "";

  try {
    const resolved = new URL(value, base).href;
    return isWebUrl(resolved) ? resolved : "";
  } catch {
    return "";
  }
}

function hostnameOf(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return url;
  }
}

function truncate(text: string, length: number): string {
  return text.length > length ? `${text.slice(0, length - 1).trimEnd()}…` : text;
}
