import {
  type Account,
  type GetAccountBalanceResponse,
  Provider,
  ProviderError,
  type Transaction,
} from "@midday/banking";

export type BankProvider = ConstructorParameters<
  typeof Provider
>[0]["provider"];

/**
 * The slice of a banking provider the sync jobs use.
 * Production uses `@midday/banking`; tests swap in a fake via
 * `setBankingClientFactory`.
 */
export interface BankingClient {
  /** "disconnected" when the provider reports the connection needs reauth. */
  getConnectionStatus(params: {
    id?: string;
    accessToken?: string;
  }): Promise<{ status: "connected" | "disconnected" }>;
  getAccounts(params: {
    id?: string;
    accessToken?: string;
    institutionId?: string;
  }): Promise<Account[]>;
  getAccountBalance(params: {
    accountId: string;
    accessToken?: string;
    accountType?: string;
  }): Promise<GetAccountBalanceResponse | null>;
  getTransactions(params: {
    accountId: string;
    accountType: Account["type"];
    latest?: boolean;
    accessToken?: string;
  }): Promise<Transaction[]>;
  deleteConnection(params: { id: string; accessToken?: string }): Promise<void>;
}

function createProviderClient(provider: BankProvider): BankingClient {
  const api = new Provider({ provider });

  return {
    async getConnectionStatus(params) {
      try {
        return await api.getConnectionStatus(params);
      } catch (error) {
        if (error instanceof ProviderError && error.code === "disconnected") {
          return { status: "disconnected" };
        }
        throw error;
      }
    },
    getAccounts: (params) => api.getAccounts(params),
    getAccountBalance: (params) => api.getAccountBalance(params),
    getTransactions: (params) => api.getTransactions(params),
    async deleteConnection(params) {
      await api.deleteConnection(params);
    },
  };
}

let factory: (provider: BankProvider) => BankingClient = createProviderClient;

export function getBankingClient(provider: BankProvider): BankingClient {
  return factory(provider);
}

/** Test seam: replace the provider factory; pass nothing to restore it. */
export function setBankingClientFactory(
  next?: (provider: BankProvider) => BankingClient,
): void {
  factory = next ?? createProviderClient;
}

/** Provider error code ("disconnected", "rate_limit", ...) or "unknown". */
export function getProviderErrorCode(error: unknown): string {
  if (error instanceof ProviderError) return error.code;
  if (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    typeof (error as { code: unknown }).code === "string"
  ) {
    return (error as { code: string }).code;
  }
  return "unknown";
}
