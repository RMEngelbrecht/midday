import { createHash } from "node:crypto";
import type { StatementTransaction } from "./types";

export type StatementInsert = {
  internal_id: string;
  team_id: string;
  status: "posted";
  method: "other";
  date: string;
  amount: number;
  name: string;
  counterparty_name: string | null;
  manual: true;
  category_slug: "income" | null;
  bank_account_id: string;
  currency: string;
  notified: true;
};

const norm = (v?: string) =>
  (v ?? "").trim().toLowerCase().replace(/\s+/g, " ");

/**
 * Stable internal_id (unique per transactions.internal_id):
 * - bank reference present: hash(account, externalId)
 * - otherwise: hash(account, date, amount, currency, description, counterparty, n)
 *   where n numbers identical rows inside one file so legit duplicates survive
 *   while re-importing the same file stays idempotent.
 * Duplicate bank references inside one file are disambiguated the same way.
 */
export function statementInternalId(args: {
  teamId: string;
  bankAccountId: string;
  currency: string;
  txn: StatementTransaction;
  occurrence: number;
}) {
  const { teamId, bankAccountId, currency, txn, occurrence } = args;
  const base = txn.externalId
    ? ["ref", bankAccountId, txn.externalId]
    : [
        "fp",
        bankAccountId,
        txn.date,
        String(txn.amount),
        currency.toUpperCase(),
        norm(txn.description),
        norm(txn.counterparty),
      ];
  if (occurrence > 1) base.push(String(occurrence));
  const hash = createHash("sha256")
    .update(base.join("|"))
    .digest("hex")
    .slice(0, 24);
  return `${teamId}_${hash}`;
}

export function statementToInserts(args: {
  teamId: string;
  bankAccountId: string;
  currency: string;
  transactions: StatementTransaction[];
}): StatementInsert[] {
  const seen = new Map<string, number>();
  return args.transactions.map((txn) => {
    const currency = (txn.currency ?? args.currency).toUpperCase();
    const key = txn.externalId
      ? `ref|${txn.externalId}`
      : [
          txn.date,
          txn.amount,
          currency,
          norm(txn.description),
          norm(txn.counterparty),
        ].join("|");
    const occurrence = (seen.get(key) ?? 0) + 1;
    seen.set(key, occurrence);
    const name = (txn.description || txn.counterparty || "Transaction").trim();
    return {
      internal_id: statementInternalId({
        teamId: args.teamId,
        bankAccountId: args.bankAccountId,
        currency,
        txn,
        occurrence,
      }),
      team_id: args.teamId,
      status: "posted",
      method: "other",
      date: txn.date,
      amount: txn.amount,
      name,
      counterparty_name: txn.counterparty?.trim() || null,
      manual: true,
      category_slug: txn.amount > 0 ? "income" : null,
      bank_account_id: args.bankAccountId,
      currency,
      notified: true,
    };
  });
}
