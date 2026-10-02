import type { Account } from "@midday/banking";
import type { Database } from "@midday/db/client";
import {
  getBankAccountsForReconnect,
  getBankConnectionForSync,
  updateBankAccountProviderIds,
} from "@midday/db/queries";
import { triggerJob } from "@midday/job-client";
import type { Job } from "bullmq";
import {
  type ReconnectConnectionPayload,
  reconnectConnectionSchema,
} from "../../schemas/banking";
import {
  type ApiAccount,
  type DbAccount,
  findMatchingAccount,
  type MatchingResult,
} from "../../utils/account-matching";
import {
  type BankingClient,
  getBankingClient,
} from "../../utils/banking-client";
import { getDb } from "../../utils/db";
import { NonRetryableError } from "../../utils/error-classification";
import { BaseProcessor } from "../base";

/**
 * After the user re-authenticates a connection, providers other than Plaid
 * may issue new account ids. Re-map them onto the existing bank accounts (so
 * transaction history is kept), then run a full sync.
 */
export class ReconnectConnectionProcessor extends BaseProcessor<ReconnectConnectionPayload> {
  protected override getPayloadSchema() {
    return reconnectConnectionSchema;
  }

  async process(job: Job<ReconnectConnectionPayload>): Promise<{
    matching: MatchingResult | null;
    syncJobId: string;
  }> {
    const { teamId, connectionId, provider } = job.data;
    const db = getDb();

    const connection = await getBankConnectionForSync(db, { id: connectionId });
    if (!connection || connection.teamId !== teamId) {
      throw new NonRetryableError(
        "Connection not found",
        undefined,
        "not_found",
      );
    }

    const client = getBankingClient(provider);
    const apiAccounts = await this.fetchProviderAccounts(client, connection);

    let matching: MatchingResult | null = null;

    // Plaid's update mode keeps account ids; the fetch only verifies access.
    if (provider !== "plaid") {
      const existing = await getBankAccountsForReconnect(db, {
        connectionId,
        teamId,
      });

      if (existing.length === 0) {
        this.logger.warn("No existing bank accounts found for connection", {
          connectionId,
          provider,
        });
      } else {
        matching = await this.matchAndUpdateAccountIds(db, {
          existingAccounts: existing.map(
            (account): DbAccount => ({
              id: account.id,
              account_reference: account.accountReference,
              iban: account.iban,
              type: account.type,
              currency: account.currency,
              name: account.name,
            }),
          ),
          apiAccounts: apiAccounts.map(
            (account): ApiAccount => ({
              id: account.id,
              resource_id: account.resource_id,
              iban: account.iban,
              type: account.type,
              currency: account.currency,
              name: account.name,
            }),
          ),
          connectionId,
          provider,
        });
      }
    }

    const sync = await triggerJob(
      "sync-connection",
      { connectionId, manualSync: true, teamId },
      "banking",
    );

    return { matching, syncJobId: sync.id };
  }

  /**
   * Provider-generic account fetch using whatever identifies the connection:
   * enrollment id (Teller), session/reference id (EnableBanking, SimpleFIN),
   * access token (Plaid, Teller).
   */
  private async fetchProviderAccounts(
    client: BankingClient,
    connection: NonNullable<
      Awaited<ReturnType<typeof getBankConnectionForSync>>
    >,
  ): Promise<Account[]> {
    const id = connection.enrollmentId ?? connection.referenceId ?? undefined;
    const accessToken = connection.accessToken ?? undefined;

    if (!id && !accessToken) {
      throw new NonRetryableError(
        `${connection.provider} connection has no credentials to reconnect with`,
      );
    }

    return client.getAccounts({
      id,
      accessToken,
      institutionId: connection.institutionId ?? undefined,
    });
  }

  private async matchAndUpdateAccountIds(
    db: Database,
    params: {
      existingAccounts: DbAccount[];
      apiAccounts: ApiAccount[];
      connectionId: string;
      provider: string;
    },
  ): Promise<MatchingResult> {
    const { existingAccounts, apiAccounts, connectionId, provider } = params;
    const matchedDbIds = new Set<string>();
    const results: MatchingResult = { matched: 0, unmatched: 0, errors: 0 };

    for (const apiAccount of apiAccounts) {
      const match = findMatchingAccount(
        apiAccount,
        existingAccounts,
        matchedDbIds,
      );

      if (!match) {
        this.logger.warn(`No matching DB account for ${provider} account`, {
          resourceId: apiAccount.resource_id,
          type: apiAccount.type,
          currency: apiAccount.currency,
        });
        results.unmatched++;
        continue;
      }

      matchedDbIds.add(match.id);

      try {
        await updateBankAccountProviderIds(db, {
          id: match.id,
          accountId: apiAccount.id,
          accountReference: apiAccount.resource_id,
          iban: apiAccount.iban,
        });
        results.matched++;
      } catch (error) {
        this.logger.warn(`Failed to update ${provider} account`, {
          dbAccountId: match.id,
          error: error instanceof Error ? error.message : String(error),
        });
        results.errors++;
      }
    }

    this.logger.info(`Account matching complete for ${provider}`, {
      connectionId,
      ...results,
      totalApiAccounts: apiAccounts.length,
      totalDbAccounts: existingAccounts.length,
    });

    return results;
  }
}
