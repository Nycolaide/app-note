import { fetch as tauriFetch } from "@tauri-apps/plugin-http";

export type Fetcher = (url: string, init?: RequestInit) => Promise<Response>;

export const defaultFetcher: Fetcher = (url, init) => tauriFetch(url, init);

export class HttpError extends Error {
  readonly status: number;

  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

const MAX_ERROR_DETAIL = 300;

export async function expectOk(response: Response, context: string, allowed: number[] = []): Promise<Response> {
  if (response.ok || allowed.includes(response.status)) {
    return response;
  }

  const detail = (await response.text().catch(() => "")).slice(0, MAX_ERROR_DETAIL);
  throw new HttpError(response.status, `${context} : HTTP ${response.status} ${detail}`.trim());
}

export async function readBytes(response: Response): Promise<Uint8Array<ArrayBuffer>> {
  return new Uint8Array(await response.arrayBuffer());
}
