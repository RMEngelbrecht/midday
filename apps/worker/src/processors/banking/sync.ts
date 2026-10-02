import type { Database } from "@midday/db/client";
import {
  getBankAccountsForSync,
  getBankConnectionForSync,
  hasAllBankAccountsFailing,
  updateBankAccountSyncState,
  updateBankConnectionSyncState,
  upsertTransactions,
} from "@midday/db/queries";
import { triggerJob } from "@midday/job-client";
import type { createLoggerWithContext } from "@midday/logger";
import type { SyncAccountPayload } from "../../schemas/banking";
import {
  getClassification,
  toTransactionRow,
} from "../../utils/bank-transactions";
import {
  getBankingClient,
  getProviderErrorCode,
} from "../../utils/banking-client";
import { NonRetryableError } from "../../utils/error-classification";

type Logger = ReturnType<typeof createLoggerWithContext>;

const UPSERT_BATCH_SIZE = 500;

/** Spacing between per-account jobs on background syncs (provider rate limits). */
export const BACKGROUND_ACCOUNT_SPACING_MS = 60_000;

/** Delay before "new transactions" notifications, to batch a whole sync. */
export const TRANSACTION_NOTIFICATION_DELAY_MS = 5 * 60_000;

/**
 * Sync one bank account: refresh the balance (healing an "XXX" currency),
 * then fetch and upsert transactions. A "disconnected" balance error bumps
 * the account's error counter and fails the sync.
 * Returns the number of newly inserted transactions.
 */
export async function syncBankAccount(
  db: Database,
  account: SyncAccountPayload,
  logger: Logger,
): Promise<number> {
  const { id, teamId, accountId, accessToken, provider, manualSync } = account;
  const client = getBankingClient(provider);
  const needsCurrencyHeal = account.currency?.toUpperCase() === "XXX";
  let currencyHealed = false;

  try {
    const balance = await client.getAccountBalance({
      accountId,
      accessToken,
      accountType: account.accountType,
    });

    if (balance && balance.amount !== null && balance.amount !== undefined) {
      const healCurrency =
        needsCurrencyHeal &&
        !!balance.currency &&
        balance.currency.toUpperCase() !== "XXX";

      await updateBankAccountSyncState(db, {
        id,
        balance: balance.amount,
        availableBalance: balance.available_balance ?? null,
        creditLimit: balance.credit_limit ?? null,
        errorDetails: null,
        errorRetries: null,
        ...(healCurrency ? { currency: balance.currency } : {}),
      });

      currencyHealed = healCurrency;
    } else {
      await updateBankAccountSyncState(db, {
        id,
        errorDetails: null,
        errorRetries: null,
      });
    }
  } catch (error) {
    const code = getProviderErrorCode(error);
    const message = error instanceof Error ? error.message : String(error);

    logger.error("Failed to sync account balance", {
      accountId,
      code,
      message,
    });

    if (code === "disconnected") {
      await updateBankAccountSyncState(db, {
        id,
        errorDetails: message,
        errorRetries: (account.errorRetries ?? 0) + 1,
      });

      throw error;
    }
  }

  const transactions = await client.getTransactions({
    accountId,
    accountType: getClassification(account.accountType),
    accessToken,
    // Manual syncs (initial import, reconnect) fetch the full history
    latest: !manualSync,
  });

  await updateBankAccountSyncState(db, {
    id,
    errorDetails: null,
    errorRetries: null,
  });

  if (!transactions?.length) {
    logger.info("No transactions to upsert", { accountId });
    return 0;
  }

  if (needsCurrencyHeal && !currencyHealed) {
    const currency = transactions.find(
      (tx) => tx.currency && tx.currency.toUpperCase() !== "XXX",
    )?.currency;

    if (currency) {
      await updateBankAccountSyncState(db, { id, currency });
    }
  }

  const rows = transactions.map((transaction) =>
    toTransactionRow({
      transaction,
      teamId,
      bankAccountId: id,
      notified: manualSync,
    }),
  );

  let inserted = 0;

  for (let i = 0; i < rows.length; i += UPSERT_BATCH_SIZE) {
    const upserted = await upsertTransactions(db, {
      transactions: rows.slice(i, i + UPSERT_BATCH_SIZE),
      teamId,
    });

    const transactionIds = upserted.map((tx) => tx.id);
    inserted += transactionIds.length;

    if (transactionIds.length > 0) {
      await triggerJob(
        "enrich-transactions",
        { transactionIds, teamId },
        "transactions",
      );
      await triggerJob(
        "match-transactions-bidirectional",
        { teamId, newTransactionIds: transactionIds },
        "inbox",
      );
    }
  }

  return inserted;
}

/**
 * When every enabled account of a connection keeps failing, mark the
 * connection disconnected so the user is prompted to reconnect.
 */
export async function disconnectIfAllAccountsFailing(
  db: Database,
  connectionId: string,
  logger: Logger,
): Promise<boolean> {
  if (!(await hasAllBankAccountsFailing(db, { connectionId }))) {
    return false;
  }

  logger.info("All bank accounts have 3+ error retries, disconnecting", {
    connectionId,
  });
  await updateBankConnectionSyncState(db, {
    id: connectionId,
    status: "disconnected",
  });
  return true;
}

export type SyncConnectionResult = {
  connectionId: string;
  teamId: string;
  status: "connected" | "disconnected";
  accounts: number;
  /** Manual syncs only: newly inserted transactions. */
  transactionsInserted?: number;
  /** Manual syncs only: accounts whose sync failed. */
  failedAccounts?: number;
};

/**
 * Check the connection with its provider and sync its accounts.
 *
 * - Manual syncs (user is waiting: initial setup, sync button, reconnect)
 *   sync every account inline, so the job completes when data is in.
 * - Background syncs fan out one `sync-account` job per account, spaced
 *   apart to respect provider rate limits, then batch a notification.
 */
export async function syncConnection(
  db: Database,
  params: { connectionId: string; manualSync?: boolean; parentJobId?: string },
  logger: Logger,
): Promise<SyncConnectionResult> {
  const { connectionId, manualSync = false } = params;

  const connection = await getBankConnectionForSync(db, { id: connectionId });
  if (!connection) {
    throw new NonRetryableError(
      `Connection not found: ${connectionId}`,
      undefined,
      "not_found",
    );
  }

  const client = getBankingClient(connection.provider);
  const { status } = await client.getConnectionStatus({
    id: connection.referenceId ?? undefined,
    accessToken: connection.accessToken ?? undefined,
  });

  if (status === "disconnected") {
    logger.info("Connection disconnected", { connectionId });
    await updateBankConnectionSyncState(db, {
      id: connectionId,
      status: "disconnected",
    });
    return {
      connectionId,
      teamId: connection.teamId,
      status,
      accounts: 0,
    };
  }

  await updateBankConnectionSyncState(db, {
    id: connectionId,
    status: "connected",
    lastAccessed: new Date().toISOString(),
  });

  const accounts = (
    await getBankAccountsForSync(db, { connectionId, manualSync })
  ).map(
    (account): SyncAccountPayload => ({
      id: account.id,
      teamId: account.teamId,
      connectionId,
      accountId: account.accountId,
      accessToken: connection.accessToken ?? undefined,
      provider: connection.provider as SyncAccountPayload["provider"],
      accountType: account.type ?? "depository",
      currency: account.currency,
      errorRetries: account.errorRetries,
      manualSync,
    }),
  );

  if (manualSync) {
    let transactionsInserted = 0;
    let failedAccounts = 0;

    for (const account of accounts) {
      try {
        transactionsInserted += await syncBankAccount(db, account, logger);
      } catch (error) {
        failedAccounts++;
        logger.error("Failed to sync account", {
          connectionId,
          bankAccountId: account.id,
          error: error instanceof Error ? error.message : String(error),
        });
      }
    }

    await disconnectIfAllAccountsFailing(db, connectionId, logger);

    return {
      connectionId,
      teamId: connection.teamId,
      status,
      accounts: accounts.length,
      transactionsInserted,
      failedAccounts,
    };
  }

  for (const [index, account] of accounts.entries()) {
    await triggerJob("sync-account", account, "banking", {
      delay: index * BACKGROUND_ACCOUNT_SPACING_MS,
      // Retried parents must not enqueue the same account twice
      ...(params.parentJobId
        ? { jobId: `sync-account-${params.parentJobId}-${account.id}` }
        : {}),
    });
  }

  if (accounts.length > 0) {
    await triggerJob(
      "transaction-notifications",
      { teamId: connection.teamId },
      "banking",
      {
        delay:
          accounts.length * BACKGROUND_ACCOUNT_SPACING_MS +
          TRANSACTION_NOTIFICATION_DELAY_MS,
      },
    );
  }

  return {
    connectionId,
    teamId: connection.teamId,
    status,
    accounts: accounts.length,
  };
}
