import type { Account, Transaction } from "@midday/banking";
import type { UpsertTransactionData } from "@midday/db/queries";

/**
 * Map a provider transaction to the row we upsert.
 * `internalId` is team-scoped so re-syncs dedupe via ON CONFLICT DO NOTHING.
 * Manual syncs (initial import, reconnect) mark rows as notified so the user
 * isn't emailed about history; background syncs leave the DB default (false).
 */
export function toTransactionRow(params: {
  transaction: Transaction;
  teamId: string;
  bankAccountId: string;
  notified?: boolean;
}): UpsertTransactionData {
  const { transaction, teamId, bankAccountId, notified } = params;

  return {
    name: transaction.name,
    description: transaction.description,
    date: transaction.date,
    amount: transaction.amount,
    currency: transaction.currency,
    method: transaction.method as UpsertTransactionData["method"],
    internalId: `${teamId}_${transaction.id}`,
    categorySlug: transaction.category,
    bankAccountId,
    balance: transaction.balance,
    teamId,
    counterpartyName: transaction.counterparty_name,
    merchantName: transaction.merchant_name ?? null,
    // We only support posted transactions for now
    status: "posted",
    manual: false,
    ...(notified ? { notified } : {}),
  };
}

/** Providers only distinguish credit vs depository when listing transactions. */
export function getClassification(
  type: Account["type"] | null | undefined,
): "credit" | "depository" {
  return type === "credit" ? "credit" : "depository";
}
