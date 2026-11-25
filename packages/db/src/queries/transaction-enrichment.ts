import {
  and,
  desc,
  eq,
  gte,
  inArray,
  isNotNull,
  isNull,
  ne,
  or,
  sql,
} from "drizzle-orm";
import type { Database } from "../client";
import { transactions } from "../schema";
import {
  CategoryHistory,
  type CategoryHistoryEntry,
} from "../utils/category-history";

export type GetTransactionsForEnrichmentParams = {
  transactionIds: string[];
  teamId: string;
};

export type TransactionForEnrichment = {
  id: string;
  name: string;
  counterpartyName: string | null;
  merchantName: string | null;
  description: string | null;
  amount: number;
  currency: string;
  categorySlug: string | null;
};

export type EnrichmentUpdateData = {
  merchantName?: string;
  categorySlug?: string;
};

export type UpdateTransactionEnrichmentParams = {
  transactionId: string;
  data: EnrichmentUpdateData;
};

/**
 * Get transactions that need enrichment (no merchantName yet)
 */
export async function getTransactionsForEnrichment(
  db: Database,
  params: GetTransactionsForEnrichmentParams,
): Promise<TransactionForEnrichment[]> {
  if (params.transactionIds.length === 0) {
    return [];
  }

  return db
    .select({
      id: transactions.id,
      name: transactions.name,
      counterpartyName: transactions.counterpartyName,
      merchantName: transactions.merchantName,
      description: transactions.description,
      amount: transactions.amount,
      currency: transactions.currency,
      categorySlug: transactions.categorySlug,
    })
    .from(transactions)
    .where(
      and(
        eq(transactions.teamId, params.teamId),
        inArray(transactions.id, params.transactionIds),
        eq(transactions.enrichmentCompleted, false), // Only non-enriched transactions
      ),
    );
}

/**
 * Update multiple transactions with enrichment data using individual updates
 *
 * @param db - Database connection
 * @param updates - Array of updates to apply (max 1000 for safety)
 * @throws Error if batch size exceeds limit or if updates fail
 */
export async function updateTransactionEnrichments(
  db: Database,
  updates: UpdateTransactionEnrichmentParams[],
): Promise<void> {
  if (updates.length === 0) {
    return;
  }

  // Safety: Limit batch size to prevent query size issues
  if (updates.length > 1000) {
    throw new Error(
      `Batch size too large: ${updates.length}. Maximum allowed: 1000`,
    );
  }

  // Safety: Validate input data
  for (const update of updates) {
    if (!update.transactionId?.trim()) {
      throw new Error("Invalid transactionId: cannot be empty");
    }
    // At least one field must be provided for update
    if (!update.data.merchantName && !update.data.categorySlug) {
      throw new Error(
        "At least one of merchantName or categorySlug must be provided",
      );
    }
    // If merchantName is provided, it cannot be empty
    if (
      update.data.merchantName !== undefined &&
      !update.data.merchantName?.trim()
    ) {
      throw new Error("Invalid merchantName: cannot be empty when provided");
    }
  }

  try {
    // Deduplicate by transactionId — later entries override earlier ones so
    // the result matches sequential semantics if callers ever pass duplicates.
    const deduped = new Map<string, EnrichmentUpdateData>();
    for (const update of updates) {
      const existing = deduped.get(update.transactionId);
      deduped.set(
        update.transactionId,
        existing ? { ...existing, ...update.data } : { ...update.data },
      );
    }

    const uniqueUpdates = Array.from(deduped.entries());

    const CHUNK_SIZE = 50;
    for (let i = 0; i < uniqueUpdates.length; i += CHUNK_SIZE) {
      const chunk = uniqueUpdates.slice(i, i + CHUNK_SIZE);

      await Promise.all(
        chunk.map(([transactionId, data]) => {
          const updateData: {
            merchantName?: string;
            categorySlug?: string;
            enrichmentCompleted: boolean;
          } = {
            enrichmentCompleted: true,
          };

          if (data.merchantName) {
            updateData.merchantName = data.merchantName;
          }
          if (data.categorySlug) {
            updateData.categorySlug = data.categorySlug;
          }

          return db
            .update(transactions)
            .set(updateData)
            .where(eq(transactions.id, transactionId));
        }),
      );
    }
  } catch (error) {
    throw new Error(
      `Failed to update transaction enrichments: ${error instanceof Error ? error.message : "Unknown error"}`,
    );
  }
}

/**
 * Mark transactions as enrichment completed without updating any other fields
 * Used for transactions that don't need merchant/category updates but should be marked as processed
 *
 * @param db - Database connection
 * @param transactionIds - Array of transaction IDs to mark as enriched
 */
export async function markTransactionsAsEnriched(
  db: Database,
  transactionIds: string[],
): Promise<void> {
  if (transactionIds.length === 0) {
    return;
  }

  // Safety: Limit batch size to prevent query size issues
  if (transactionIds.length > 1000) {
    throw new Error(
      `Batch size too large: ${transactionIds.length}. Maximum allowed: 1000`,
    );
  }

  // Safety: Validate input data
  for (const id of transactionIds) {
    if (!id?.trim()) {
      throw new Error("Invalid transactionId: cannot be empty");
    }
  }

  try {
    await db
      .update(transactions)
      .set({ enrichmentCompleted: true })
      .where(inArray(transactions.id, transactionIds));
  } catch (error) {
    throw new Error(
      `Failed to mark transactions as enriched: ${error instanceof Error ? error.message : "Unknown error"}`,
    );
  }
}

/**
 * Transactions still waiting for enrichment, newest first, across all teams.
 * Picks up rows synced while AI was off or whose enrichment hit a provider
 * error.
 */
export async function getTransactionsPendingEnrichment(
  db: Database,
  params: { limit: number },
): Promise<Array<{ id: string; teamId: string }>> {
  return db
    .select({ id: transactions.id, teamId: transactions.teamId })
    .from(transactions)
    .where(eq(transactions.enrichmentCompleted, false))
    .orderBy(desc(transactions.date))
    .limit(params.limit);
}

/** How far back categorisation history reaches. */
const CATEGORY_HISTORY_MONTHS = 18;
/** Distinct vendor/category rows loaded per team, most recent first. */
const CATEGORY_HISTORY_LIMIT = 20_000;

/**
 * The team's categorised transactions from the last 18 months, grouped by
 * vendor identity, category and direction (in or out). Feeds CategoryHistory,
 * which lets enrichment repeat the team's own choices for known vendors.
 * Uncategorized is left out: it is the fallback, not a choice.
 */
export async function getCategoryHistory(
  db: Database,
  params: { teamId: string },
): Promise<CategoryHistoryEntry[]> {
  const incoming = sql<boolean>`${transactions.amount} > 0`;

  const rows = await db
    .select({
      name: transactions.name,
      merchantName: transactions.merchantName,
      counterpartyName: transactions.counterpartyName,
      categorySlug: transactions.categorySlug,
      incoming,
      count: sql<number>`count(*)::int`,
    })
    .from(transactions)
    .where(
      and(
        eq(transactions.teamId, params.teamId),
        isNotNull(transactions.categorySlug),
        ne(transactions.categorySlug, "uncategorized"),
        gte(
          transactions.date,
          sql`(current_date - make_interval(months => ${CATEGORY_HISTORY_MONTHS}))::date`,
        ),
      ),
    )
    .groupBy(
      transactions.name,
      transactions.merchantName,
      transactions.counterpartyName,
      transactions.categorySlug,
      incoming,
    )
    .orderBy(desc(sql`max(${transactions.date})`))
    .limit(CATEGORY_HISTORY_LIMIT);

  return rows.map((row) => ({ ...row, categorySlug: row.categorySlug! }));
}

/**
 * Categorises the team's uncategorised transactions (no category, or
 * Uncategorized) where its history for the same vendor agrees, as enrichment
 * does for new ones. Never touches a transaction that has a real category.
 * With `dryRun` it only counts, for a confirmation prompt.
 */
export async function applyCategoryHistory(
  db: Database,
  params: { teamId: string; dryRun?: boolean },
): Promise<{ count: number }> {
  const history = new CategoryHistory(
    await getCategoryHistory(db, { teamId: params.teamId }),
  );

  const uncategorized = await db
    .select({
      id: transactions.id,
      name: transactions.name,
      merchantName: transactions.merchantName,
      counterpartyName: transactions.counterpartyName,
      amount: transactions.amount,
    })
    .from(transactions)
    .where(
      and(
        eq(transactions.teamId, params.teamId),
        or(
          isNull(transactions.categorySlug),
          eq(transactions.categorySlug, "uncategorized"),
        ),
      ),
    );

  const idsBySlug = new Map<string, string[]>();
  for (const transaction of uncategorized) {
    const suggestion = history.suggest(transaction);
    if (!suggestion) continue;
    const ids = idsBySlug.get(suggestion.categorySlug) ?? [];
    ids.push(transaction.id);
    idsBySlug.set(suggestion.categorySlug, ids);
  }

  const count = [...idsBySlug.values()].reduce(
    (sum, ids) => sum + ids.length,
    0,
  );
  if (params.dryRun || count === 0) return { count };

  await db.transaction(async (tx) => {
    for (const [categorySlug, ids] of idsBySlug) {
      for (let i = 0; i < ids.length; i += 1000) {
        await tx
          .update(transactions)
          .set({ categorySlug })
          .where(
            and(
              eq(transactions.teamId, params.teamId),
              inArray(transactions.id, ids.slice(i, i + 1000)),
              // Skip rows categorised since they were read.
              or(
                isNull(transactions.categorySlug),
                eq(transactions.categorySlug, "uncategorized"),
              ),
            ),
          );
      }
    }
  });

  return { count };
}
