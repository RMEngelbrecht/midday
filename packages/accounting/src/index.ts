import { ENV } from "./env";
import type { AccountingProvider } from "./provider";
import { FortnoxProvider } from "./providers/fortnox";
import { QuickBooksProvider } from "./providers/quickbooks";
import { XeroProvider } from "./providers/xero";
import type {
  AccountingProviderConfig,
  AccountingProviderId,
  ProviderInitConfig,
} from "./types";

export * from "./provider";
export { FORTNOX_SCOPES, FortnoxProvider } from "./providers/fortnox";
export { QUICKBOOKS_SCOPES, QuickBooksProvider } from "./providers/quickbooks";
export { XERO_SCOPES, XeroProvider } from "./providers/xero";
// Re-export types
export * from "./types";
export * from "./utils";

/**
 * OAuth credentials (from env) for each provider
 */
function readProviderEnv(providerId: AccountingProviderId) {
  switch (providerId) {
    case "xero":
      return {
        clientId: ENV.XERO_CLIENT_ID,
        clientSecret: ENV.XERO_CLIENT_SECRET,
        redirectUri: ENV.XERO_OAUTH_REDIRECT_URL,
      };
    case "quickbooks":
      return {
        clientId: ENV.QUICKBOOKS_CLIENT_ID,
        clientSecret: ENV.QUICKBOOKS_CLIENT_SECRET,
        redirectUri: ENV.QUICKBOOKS_OAUTH_REDIRECT_URL,
      };
    case "fortnox":
      return {
        clientId: ENV.FORTNOX_CLIENT_ID,
        clientSecret: ENV.FORTNOX_CLIENT_SECRET,
        redirectUri: ENV.FORTNOX_OAUTH_REDIRECT_URL,
      };
  }
}

/**
 * Get OAuth credentials from environment variables for a provider
 *
 * @throws Error if any required credentials are missing
 */
export function getProviderOAuthCredentials(providerId: AccountingProviderId): {
  clientId: string;
  clientSecret: string;
  redirectUri: string;
} {
  const { clientId, clientSecret, redirectUri } = readProviderEnv(providerId);

  if (!clientId || !clientSecret || !redirectUri) {
    throw new Error(`OAuth configuration missing for ${providerId}`);
  }

  return { clientId, clientSecret, redirectUri };
}

/**
 * Get an initialized accounting provider instance
 *
 * @param providerId - The provider identifier
 * @param config - Optional stored provider config (tokens, tenant info)
 * @returns An initialized AccountingProvider instance
 *
 * @example
 * ```typescript
 * const provider = getAccountingProvider('xero', storedConfig);
 * const accounts = await provider.getAccounts(orgId);
 * ```
 */
export function getAccountingProvider(
  providerId: AccountingProviderId,
  config?: AccountingProviderConfig,
): AccountingProvider {
  const credentials = getProviderOAuthCredentials(providerId);

  const initConfig: ProviderInitConfig = {
    ...credentials,
    config,
  };

  switch (providerId) {
    case "xero":
      return new XeroProvider(initConfig);

    case "quickbooks":
      return new QuickBooksProvider(initConfig);

    case "fortnox":
      return new FortnoxProvider(initConfig);

    default: {
      // TypeScript exhaustive check
      const _exhaustive: never = providerId;
      throw new Error(`Unknown accounting provider: ${_exhaustive}`);
    }
  }
}

/**
 * Check if a provider is currently supported
 */
export function isProviderSupported(providerId: string): boolean {
  return (
    providerId === "xero" ||
    providerId === "quickbooks" ||
    providerId === "fortnox"
  );
}

/**
 * Get list of all supported provider IDs
 */
export function getSupportedProviders(): AccountingProviderId[] {
  return ["xero", "quickbooks", "fortnox"];
}
