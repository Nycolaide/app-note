import { invoke } from "@tauri-apps/api/core";
import { openUrl } from "@tauri-apps/plugin-opener";
import { authorizationUrl, createPkce, exchangeCode, randomState, type GoogleClient } from "$lib/core";

const clientId = import.meta.env.VITE_GOOGLE_CLIENT_ID ?? "";
const clientSecret = import.meta.env.VITE_GOOGLE_CLIENT_SECRET ?? "";

export const googleClient: GoogleClient | null = clientId && clientSecret ? { clientId, clientSecret } : null;

export class GoogleSignInCancelled extends Error {
  constructor() {
    super("Connexion Google annulée.");
  }
}

export async function signInWithGoogle(client: GoogleClient): Promise<string> {
  const port = await invoke<number>("oauth_listen");
  const redirectUri = `http://127.0.0.1:${port}`;
  const pkce = await createPkce();
  const state = randomState();

  await openUrl(authorizationUrl(client, { redirectUri, challenge: pkce.challenge, state }));
  const target = await invoke<string>("oauth_wait").catch((error: unknown) => {
    throw String(error).includes("annulée") ? new GoogleSignInCancelled() : new Error(String(error));
  });
  const params = new URL(target, redirectUri).searchParams;

  if (params.get("state") !== state) {
    throw new Error("Réponse de Google invalide. Réessaie la connexion.");
  }

  const code = params.get("code");
  if (!code) {
    throw params.get("error") === "access_denied"
      ? new GoogleSignInCancelled()
      : new Error(`Google a refusé la connexion (${params.get("error") ?? "erreur inconnue"}).`);
  }

  return exchangeCode(client, { code, redirectUri, verifier: pkce.verifier });
}

export function cancelGoogleSignIn(): Promise<void> {
  return invoke("oauth_cancel");
}
