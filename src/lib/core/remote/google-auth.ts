import { defaultFetcher, HttpError, type Fetcher } from "../http";

export interface GoogleClient {
  clientId: string;
  clientSecret: string;
}

export interface Pkce {
  verifier: string;
  challenge: string;
}

export interface AuthorizationRequest {
  redirectUri: string;
  challenge: string;
  state: string;
}

export interface CodeExchange {
  code: string;
  redirectUri: string;
  verifier: string;
}

const AUTHORIZATION_ENDPOINT = "https://accounts.google.com/o/oauth2/v2/auth";
const TOKEN_ENDPOINT = "https://oauth2.googleapis.com/token";
export const DRIVE_FILE_SCOPE = "https://www.googleapis.com/auth/drive.file";
const EXPIRY_MARGIN_MS = 60_000;

export class GoogleAuthRevokedError extends Error {
  constructor() {
    super("L'accès Google a été révoqué ou a expiré. Retire ce vault puis reconnecte-le.");
  }
}

export class GoogleAuth {
  readonly #client: GoogleClient;
  readonly #refreshToken: string;
  readonly #fetch: Fetcher;
  #accessToken: Promise<{ token: string; expiresAt: number }> | null = null;

  constructor(client: GoogleClient, refreshToken: string, fetcher: Fetcher = defaultFetcher) {
    this.#client = client;
    this.#refreshToken = refreshToken;
    this.#fetch = fetcher;
  }

  async accessToken(): Promise<string> {
    if (this.#accessToken) {
      const current = await this.#accessToken.catch(() => null);
      if (current && current.expiresAt - EXPIRY_MARGIN_MS > Date.now()) return current.token;
    }

    this.#accessToken = this.#refresh();
    return (await this.#accessToken).token;
  }

  invalidate(): void {
    this.#accessToken = null;
  }

  async #refresh(): Promise<{ token: string; expiresAt: number }> {
    const response = await postForm(this.#fetch, {
      client_id: this.#client.clientId,
      client_secret: this.#client.clientSecret,
      refresh_token: this.#refreshToken,
      grant_type: "refresh_token",
    });

    if (response.status === 400 || response.status === 401) {
      throw new GoogleAuthRevokedError();
    }

    const body = await tokenBody(response);
    return { token: body.access_token, expiresAt: Date.now() + body.expires_in * 1000 };
  }
}

export async function createPkce(): Promise<Pkce> {
  const verifier = base64Url(crypto.getRandomValues(new Uint8Array(48)));
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(verifier));
  return { verifier, challenge: base64Url(new Uint8Array(digest)) };
}

export function randomState(): string {
  return base64Url(crypto.getRandomValues(new Uint8Array(24)));
}

export function authorizationUrl(client: GoogleClient, request: AuthorizationRequest): string {
  const url = new URL(AUTHORIZATION_ENDPOINT);
  url.search = new URLSearchParams({
    client_id: client.clientId,
    redirect_uri: request.redirectUri,
    response_type: "code",
    scope: DRIVE_FILE_SCOPE,
    code_challenge: request.challenge,
    code_challenge_method: "S256",
    state: request.state,
    access_type: "offline",
    prompt: "consent",
  }).toString();
  return url.href;
}

export async function exchangeCode(
  client: GoogleClient,
  exchange: CodeExchange,
  fetcher: Fetcher = defaultFetcher,
): Promise<string> {
  const response = await postForm(fetcher, {
    client_id: client.clientId,
    client_secret: client.clientSecret,
    code: exchange.code,
    code_verifier: exchange.verifier,
    redirect_uri: exchange.redirectUri,
    grant_type: "authorization_code",
  });
  const body = await tokenBody(response);

  if (!body.refresh_token) {
    throw new Error("Google n'a pas fourni de jeton de renouvellement. Réessaie la connexion.");
  }

  return body.refresh_token;
}

interface TokenBody {
  access_token: string;
  expires_in: number;
  refresh_token?: string;
}

function postForm(fetcher: Fetcher, fields: Record<string, string>): Promise<Response> {
  return fetcher(TOKEN_ENDPOINT, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams(fields).toString(),
  });
}

async function tokenBody(response: Response): Promise<TokenBody> {
  if (!response.ok) {
    const detail = await response.text().catch(() => "");
    throw new HttpError(response.status, `Connexion Google : HTTP ${response.status} ${detail.slice(0, 300)}`.trim());
  }
  return response.json();
}

function base64Url(bytes: Uint8Array): string {
  return btoa(String.fromCharCode(...bytes))
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
}
