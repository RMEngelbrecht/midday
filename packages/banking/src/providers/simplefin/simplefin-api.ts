import { decrypt, encrypt } from "@midday/encryption";
import type { GetConnectionStatusResponse } from "../../types";
import { ProviderError } from "../../utils/error";
import { logger } from "../../utils/logger";
import { withRateLimitRetry } from "../../utils/retry";
import type { SimplefinAccount, SimplefinAccountSet } from "./types";

/** SimpleFIN bridges serve at most 90 days of history per request. */
export const MAX_HISTORY_DAYS = 90;
const LATEST_DAYS = 14;

/** Setup tokens are base64(claim URL). Tolerates URL-safe base64 and whitespace. */
export function decodeSetupToken(setupToken: string): string {
  const normalized = setupToken
    .trim()
    .replace(/\s+/g, "")
    .replace(/-/g, "+")
    .replace(/_/g, "/");
  const url = Buffer.from(normalized, "base64").toString("utf8").trim();

  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    throw new ProviderError({
      code: "invalid_token",
      message: "Invalid SimpleFIN setup token",
    });
  }

  if (parsed.protocol !== "https:" && parsed.protocol !== "http:") {
    throw new ProviderError({
      code: "invalid_token",
      message: "Invalid SimpleFIN setup token",
    });
  }

  return parsed.toString();
}

/** Split an access URL into a credential-free base URL and a Basic auth header. */
export function parseAccessUrl(accessUrl: string) {
  const url = new URL(accessUrl);
  const username = decodeURIComponent(url.username);
  const password = decodeURIComponent(url.password);
  url.username = "";
  url.password = "";

  return {
    baseUrl: url.toString().replace(/\/$/, ""),
    authorization: `Basic ${Buffer.from(`${username}:${password}`).toString("base64")}`,
  };
}

/**
 * The access URL embeds basic-auth credentials, so it is stored encrypted in
 * bank_connections.access_token (the same column other providers use).
 */
export function encryptAccessUrl(accessUrl: string) {
  return encrypt(accessUrl);
}

export function resolveAccessUrl(accessToken: string) {
  // Plain URLs are accepted for scripts/tests; stored tokens are encrypted.
  return /^https?:\/\//i.test(accessToken) ? accessToken : decrypt(accessToken);
}

function describeErrors(set: SimplefinAccountSet) {
  const messages = [
    ...(set.errors ?? []),
    ...(set.errlist ?? []).map((e) => `${e.code ?? "error"}: ${e.msg ?? ""}`),
  ];
  return messages.filter(Boolean);
}

export class SimplefinApi {
  #fetch: typeof fetch;

  constructor(fetchImpl: typeof fetch = fetch) {
    this.#fetch = fetchImpl;
  }

  /** Exchange a setup token for an (unencrypted) access URL. */
  async claim(setupToken: string): Promise<string> {
    const claimUrl = decodeSetupToken(setupToken);
    const response = await this.#fetch(claimUrl, {
      method: "POST",
      headers: { "Content-Length": "0" },
    });

    if (response.status === 403 || response.status === 404) {
      throw new ProviderError({
        code: "invalid_token",
        message:
          "SimpleFIN setup token is invalid or was already claimed. Create a new token.",
      });
    }

    if (!response.ok) {
      throw new ProviderError({
        code: "claim_failed",
        message: `SimpleFIN claim failed (${response.status})`,
      });
    }

    const accessUrl = (await response.text()).trim();
    try {
      parseAccessUrl(accessUrl);
    } catch {
      throw new ProviderError({
        code: "claim_failed",
        message: "SimpleFIN returned an invalid access URL",
      });
    }
    return accessUrl;
  }

  async #get(
    accessToken: string,
    params: Record<string, string | string[]>,
  ): Promise<SimplefinAccountSet> {
    const { baseUrl, authorization } = parseAccessUrl(
      resolveAccessUrl(accessToken),
    );
    const query = new URLSearchParams();
    for (const [key, value] of Object.entries(params)) {
      for (const v of Array.isArray(value) ? value : [value]) {
        query.append(key, v);
      }
    }

    return withRateLimitRetry(async () => {
      const response = await this.#fetch(`${baseUrl}/accounts?${query}`, {
        headers: { Authorization: authorization },
      });

      if (response.status === 403 || response.status === 401) {
        throw new ProviderError({
          code: "simplefin.disconnected",
          message: "SimpleFIN access was revoked or the token is invalid",
        });
      }
      if (response.status === 402) {
        throw new ProviderError({
          code: "payment_required",
          message: "SimpleFIN Bridge subscription requires payment",
        });
      }
      if (!response.ok) {
        const error = new Error(
          `SimpleFIN request failed (${response.status})`,
        );
        (error as unknown as { response: unknown }).response = {
          status: response.status,
          headers: Object.fromEntries(response.headers.entries()),
        };
        throw error;
      }

      const data = (await response.json()) as SimplefinAccountSet;
      const errors = describeErrors(data);
      if (errors.length > 0) {
        logger.warn("SimpleFIN reported errors", { errors });
      }
      return { ...data, accounts: data.accounts ?? [] };
    });
  }

  /** Accounts with balances, no transactions. */
  async getAccounts({ accessToken }: { accessToken: string }) {
    return this.#get(accessToken, { "balances-only": "1" });
  }

  async getAccountBalance({
    accessToken,
    accountId,
  }: {
    accessToken: string;
    accountId: string;
  }): Promise<SimplefinAccount | undefined> {
    const set = await this.#get(accessToken, {
      "balances-only": "1",
      account: accountId,
    });
    return set.accounts.find((a) => a.id === accountId);
  }

  async getTransactions({
    accessToken,
    accountId,
    latest,
    now = Date.now(),
  }: {
    accessToken: string;
    accountId: string;
    latest?: boolean;
    now?: number;
  }) {
    const days = latest ? LATEST_DAYS : MAX_HISTORY_DAYS;
    const start = Math.floor(now / 1000) - days * 86400;
    const set = await this.#get(accessToken, {
      "start-date": String(start),
      pending: "1",
      account: accountId,
    });
    return set;
  }

  async getConnectionStatus({
    accessToken,
  }: {
    accessToken: string;
  }): Promise<GetConnectionStatusResponse> {
    try {
      const set = await this.#get(accessToken, { "balances-only": "1" });
      return { status: set.accounts.length > 0 ? "connected" : "disconnected" };
    } catch (error) {
      if (error instanceof ProviderError && error.code === "disconnected") {
        return { status: "disconnected" };
      }
      throw error;
    }
  }

  async getHealthCheck() {
    // No fixed host: every user brings their own bridge access URL.
    return true;
  }
}
