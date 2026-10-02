import { decrypt, encrypt } from "@midday/encryption";
import { and, desc, eq, isNull, lt, ne, or, sql } from "drizzle-orm";
import type { Database } from "../client";
import {
  bankAccounts,
  bankConnections,
  inboxAccounts,
  transactions,
} from "../schema";

/**
 * Queries used by the worker's bank sync, reconnect and scheduling jobs.
 */

export async function getBankConnectionForSync(
  db: Database,
  params: { id: string },
) {
  const [result] = await db
    .select({
      id: bankConnections.id,
      teamId: bankConnections.teamId,
      provider: bankConnections.provider,
      accessToken: bankConnections.accessToken,
      referenceId: bankConnections.referenceId,
      enrollmentId: bankConnections.enrollmentId,
      institutionId: bankConnections.institutionId,
      status: bankConnections.status,
    })
    .from(bankConnections)
    .where(eq(bankConnections.id, params.id))
    .limit(1);

  return result ?? null;
}

export type UpdateBankConnectionSyncStateParams = {
  id: string;
  status?: "connected" | "disconnected" | "unknown";
  lastAccessed?: string;
  referenceId?: string;
};

export async function updateBankConnectionSyncState(
  db: Database,
  params: UpdateBankConnectionSyncStateParams,
) {
  const { id, ...data } = params;

  await db.update(bankConnections).set(data).where(eq(bankConnections.id, id));
}

/**
 * Enabled, provider-backed accounts of a connection.
 * Background syncs skip accounts that have failed more than 3 times;
 * manual syncs include them so a reconnect can clear the errors.
 */
export async function getBankAccountsForSync(
  db: Database,
  params: { connectionId: string; manualSync?: boolean },
) {
  const conditions = [
    eq(bankAccounts.bankConnectionId, params.connectionId),
    eq(bankAccounts.enabled, true),
    eq(bankAccounts.manual, false),
  ];

  if (!params.manualSync) {
    conditions.push(
      or(lt(bankAccounts.errorRetries, 4), isNull(bankAccounts.errorRetries))!,
    );
  }

  return db
    .select({
      id: bankAccounts.id,
      teamId: bankAccounts.teamId,
      accountId: bankAccounts.accountId,
      type: bankAccounts.type,
      currency: bankAccounts.currency,
      errorRetries: bankAccounts.errorRetries,
    })
    .from(bankAccounts)
    .where(and(...conditions));
}

/**
 * True when a connection has at least one enabled provider account and every
 * one of them has failed 3+ times in a row, i.e. the user should reconnect.
 */
export async function hasAllBankAccountsFailing(
  db: Database,
  params: { connectionId: string },
): Promise<boolean> {
  const [result] = await db
    .select({
      total: sql<number>`count(*)::int`,
      healthy: sql<number>`count(*) filter (where coalesce(${bankAccounts.errorRetries}, 0) < 3)::int`,
    })
    .from(bankAccounts)
    .where(
      and(
        eq(bankAccounts.bankConnectionId, params.connectionId),
        eq(bankAccounts.enabled, true),
        eq(bankAccounts.manual, false),
      ),
    );

  return !!result && result.total > 0 && result.healthy === 0;
}

export type UpdateBankAccountSyncStateParams = {
  id: string;
  balance?: number;
  availableBalance?: number | null;
  creditLimit?: number | null;
  currency?: string;
  errorDetails?: string | null;
  errorRetries?: number | null;
};

export async function updateBankAccountSyncState(
  db: Database,
  params: UpdateBankAccountSyncStateParams,
) {
  const { id, ...data } = params;

  await db.update(bankAccounts).set(data).where(eq(bankAccounts.id, id));
}

/**
 * Accounts of a connection in the shape used for reconnect matching.
 * IBAN is decrypted so it can be compared with the provider's value.
 */
export async function getBankAccountsForReconnect(
  db: Database,
  params: { connectionId: string; teamId: string },
) {
  const rows = await db
    .select({
      id: bankAccounts.id,
      accountReference: bankAccounts.accountReference,
      iban: bankAccounts.iban,
      type: bankAccounts.type,
      currency: bankAccounts.currency,
      name: bankAccounts.name,
    })
    .from(bankAccounts)
    .where(
      and(
        eq(bankAccounts.bankConnectionId, params.connectionId),
        eq(bankAccounts.teamId, params.teamId),
      ),
    );

  return rows.map((row) => ({
    ...row,
    iban: row.iban ? safeDecrypt(row.iban) : null,
  }));
}

function safeDecrypt(value: string): string | null {
  try {
    return decrypt(value);
  } catch {
    return null;
  }
}

export async function updateBankAccountProviderIds(
  db: Database,
  params: {
    id: string;
    accountId: string;
    accountReference?: string | null;
    iban?: string | null;
  },
) {
  await db
    .update(bankAccounts)
    .set({
      accountId: params.accountId,
      ...(params.accountReference
        ? { accountReference: params.accountReference }
        : {}),
      ...(params.iban ? { iban: encrypt(params.iban) } : {}),
    })
    .where(eq(bankAccounts.id, params.id));
}

export async function countBankConnections(
  db: Database,
  params: { teamId: string },
): Promise<number> {
  const [result] = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(bankConnections)
    .where(eq(bankConnections.teamId, params.teamId));

  return result?.count ?? 0;
}

/**
 * Mark all unnotified transactions of a team as notified and return them,
 * newest first. Used to batch "new transactions" notifications after a sync.
 */
export async function markTeamTransactionsNotified(
  db: Database,
  params: { teamId: string },
) {
  const rows = await db
    .update(transactions)
    .set({ notified: true })
    .where(
      and(
        eq(transactions.teamId, params.teamId),
        eq(transactions.notified, false),
      ),
    )
    .returning({
      id: transactions.id,
      date: transactions.date,
      amount: transactions.amount,
      name: transactions.name,
      currency: transactions.currency,
    });

  return rows.sort((a, b) => b.date.localeCompare(a.date));
}

/**
 * Inbox accounts that should have a periodic sync scheduler.
 */
export async function getInboxAccountIdsForScheduling(db: Database) {
  return db
    .select({ id: inboxAccounts.id })
    .from(inboxAccounts)
    .where(ne(inboxAccounts.status, "disconnected"))
    .orderBy(desc(inboxAccounts.createdAt));
}
