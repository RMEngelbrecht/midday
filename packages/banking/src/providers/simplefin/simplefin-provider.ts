import type { Provider } from "../../interface";
import type {
  DeleteAccountsRequest,
  DeleteConnectionRequest,
  GetAccountBalanceRequest,
  GetAccountsRequest,
  GetConnectionStatusRequest,
  GetInstitutionsResponse,
  GetTransactionsRequest,
} from "../../types";
import { SimplefinApi } from "./simplefin-api";
import {
  SIMPLEFIN_INSTITUTION,
  transformAccount,
  transformBalance,
  transformTransaction,
} from "./transform";

/**
 * SimpleFIN Bridge (US/CA). `accessToken` is the encrypted access URL produced
 * by `SimplefinApi.claim` + `encryptAccessUrl`. There is no webhook, institution
 * list or server-side credential: the user's access URL is the only secret.
 */
export class SimplefinProvider implements Provider {
  #api: SimplefinApi;

  constructor(api = new SimplefinApi()) {
    this.#api = api;
  }

  async getHealthCheck() {
    return this.#api.getHealthCheck();
  }

  async getTransactions({
    accountId,
    accessToken,
    latest,
  }: GetTransactionsRequest) {
    if (!accessToken) throw Error("accessToken missing");

    const set = await this.#api.getTransactions({
      accessToken,
      accountId,
      latest,
    });
    const account = set.accounts.find((a) => a.id === accountId);

    return (account?.transactions ?? []).map((transaction) =>
      transformTransaction({
        transaction,
        currency: account?.currency ?? "USD",
      }),
    );
  }

  async getAccounts({ accessToken }: GetAccountsRequest) {
    if (!accessToken) throw Error("accessToken missing");

    const set = await this.#api.getAccounts({ accessToken });
    return set.accounts.map((account) => transformAccount(account, set));
  }

  async getAccountBalance({
    accessToken,
    accountId,
  }: GetAccountBalanceRequest) {
    if (!accessToken || !accountId) throw Error("Missing params");

    const account = await this.#api.getAccountBalance({
      accessToken,
      accountId,
    });
    if (!account) throw Error("Account not found");
    return transformBalance(account);
  }

  /** Pseudo-institution so SimpleFIN shows up in institution search. */
  async getInstitutions(): Promise<GetInstitutionsResponse> {
    return [SIMPLEFIN_INSTITUTION];
  }

  // SimpleFIN access URLs cannot be revoked via the API: the user revokes the
  // token in their bridge account. Removing the stored token is enough.
  async deleteAccounts(_params: DeleteAccountsRequest) {}

  async getConnectionStatus({ accessToken }: GetConnectionStatusRequest) {
    if (!accessToken) throw Error("accessToken missing");
    return this.#api.getConnectionStatus({ accessToken });
  }

  async deleteConnection(_params: DeleteConnectionRequest) {}
}
