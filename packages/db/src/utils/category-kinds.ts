import type { CategoryKind } from "@midday/categories";
import { and, eq, inArray } from "drizzle-orm";
import type { Database } from "../client";
import { transactionCategories } from "../schema";

/**
 * Subquery of a team's category slugs with the given kinds, for
 * `inArray(transactions.categorySlug, ...)`. Replaces the old hard-coded slug
 * lists, so custom categories count and deleted ones drop out.
 */
export function categorySlugsOfKind(
  db: Database,
  teamId: string,
  kinds: CategoryKind[],
) {
  return db
    .select({ slug: transactionCategories.slug })
    .from(transactionCategories)
    .where(
      and(
        eq(transactionCategories.teamId, teamId),
        inArray(transactionCategories.kind, kinds),
      ),
    );
}
