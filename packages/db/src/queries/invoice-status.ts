import { and, eq, gte, inArray, ne, sql } from "drizzle-orm";
import type { Database } from "../client";
import { invoices, transactionAttachments, transactions } from "../schema";

/**
 * Queries used by the worker's periodic invoice status check
 * (match a payment transaction, or mark the invoice overdue).
 */

export async function getInvoiceIdsForStatusCheck(db: Database) {
  return db
    .select({ id: invoices.id })
    .from(invoices)
    .where(inArray(invoices.status, ["unpaid", "overdue"]));
}

export async function getInvoiceForStatusCheck(
  db: Database,
  params: { id: string },
) {
  const [result] = await db
    .select({
      id: invoices.id,
      status: invoices.status,
      dueDate: invoices.dueDate,
      currency: invoices.currency,
      amount: invoices.amount,
      teamId: invoices.teamId,
      filePath: invoices.filePath,
      fileSize: invoices.fileSize,
      invoiceNumber: invoices.invoiceNumber,
      customerName: invoices.customerName,
      template: invoices.template,
    })
    .from(invoices)
    .where(eq(invoices.id, params.id))
    .limit(1);

  return result ?? null;
}

/**
 * Transactions that could be the payment for an invoice: same team, exact
 * amount and currency, dated on/after `since`, and not yet fulfilled
 * (no attachment and not completed).
 */
export async function findInvoicePaymentCandidates(
  db: Database,
  params: { teamId: string; amount: number; currency: string; since: string },
) {
  return db
    .select({ id: transactions.id })
    .from(transactions)
    .where(
      and(
        eq(transactions.teamId, params.teamId),
        eq(transactions.amount, params.amount),
        eq(transactions.currency, params.currency.toUpperCase()),
        gte(transactions.date, params.since),
        ne(transactions.status, "completed"),
        sql`NOT EXISTS (
          SELECT 1 FROM ${transactionAttachments}
          WHERE ${transactionAttachments.transactionId} = ${transactions.id}
        )`,
      ),
    );
}
