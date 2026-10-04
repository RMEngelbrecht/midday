import {
  emailOTPClient,
  jwtClient,
  twoFactorClient,
} from "better-auth/client/plugins";
import { createAuthClient } from "better-auth/react";
import { getClientPublicConfig } from "@/components/public-config-provider";

/** Mounted on the API (apps/api/src/auth). */
export const AUTH_BASE_PATH = "/auth";

// Shown when an auth request never reaches the API (wrong API_URL, http vs
// https mismatch, API down). better-auth only reports HTTP errors itself.
export const UNREACHABLE_MESSAGE =
  "Can't reach the server. Check that API_URL is correct and reachable from your browser.";

function create(apiUrl: string) {
  return createAuthClient({
    baseURL: `${apiUrl}${AUTH_BASE_PATH}`,
    fetchOptions: { credentials: "include" },
    plugins: [emailOTPClient(), twoFactorClient(), jwtClient()],
  });
}

let client: ReturnType<typeof create> | null = null;

/**
 * better-auth client pointed at API_URL. The API URL is runtime config
 * (PublicConfig), so the client is created lazily on first use.
 */
export function getAuthClient() {
  client ??= create(getClientPublicConfig().apiUrl);
  return client;
}

let cachedToken: { value: string; expiresAt: number } | null = null;

function jwtExpiry(token: string): number {
  try {
    const payload = JSON.parse(
      atob(token.split(".")[1]!.replace(/-/g, "+").replace(/_/g, "/")),
    ) as { exp?: number };
    return (payload.exp ?? 0) * 1000;
  } catch {
    return 0;
  }
}

/**
 * Short-lived JWT for calling the API (tRPC/REST) as `Authorization: Bearer`.
 * Cached until a minute before it expires.
 */
export async function getAccessToken(): Promise<string | null> {
  if (cachedToken && cachedToken.expiresAt - 60_000 > Date.now()) {
    return cachedToken.value;
  }

  const { data } = await getAuthClient().token();
  if (!data?.token) {
    cachedToken = null;
    return null;
  }

  cachedToken = { value: data.token, expiresAt: jwtExpiry(data.token) };
  return data.token;
}

export async function signOut() {
  cachedToken = null;
  await getAuthClient().signOut();
}
