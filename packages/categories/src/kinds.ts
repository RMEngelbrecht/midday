/**
 * Category kinds decide what a category means for reports and filters, so
 * any category (built-in or custom) can count as income, a refund, cost of
 * goods or a transfer.
 */
export const CATEGORY_KINDS = [
  "expense",
  "income",
  "refund",
  "cost_of_goods",
  "transfer",
] as const;

export type CategoryKind = (typeof CATEGORY_KINDS)[number];

/**
 * Built-in categories that cannot be deleted: Uncategorized is the fallback
 * for enrichment and for transactions of deleted categories, and Internal
 * Transfer keeps moves between your own accounts out of the totals.
 */
export const PROTECTED_CATEGORY_SLUGS = [
  "uncategorized",
  "internal-transfer",
] as const;

export function isProtectedCategory(slug: string | null | undefined): boolean {
  return (PROTECTED_CATEGORY_SLUGS as readonly string[]).includes(slug ?? "");
}

/** Built-in income categories; each team's kinds start from these. */
export const REVENUE_CATEGORIES = [
  "revenue",
  "income",
  "product-sales",
  "service-revenue",
  "consulting-revenue",
  "subscription-revenue",
  "interest-income",
  "other-income",
] as const;

/** Built-in refund (contra-revenue) categories. */
export const CONTRA_REVENUE_CATEGORIES = [
  "customer-refunds",
  "chargebacks-disputes",
] as const;

const TRANSFER_CATEGORIES = ["transfer", "internal-transfer"] as const;

const COST_OF_GOODS_PARENT = "cost-of-goods-sold";

/** The kind a built-in category starts with. */
export function getDefaultCategoryKind(
  slug: string,
  parentSlug?: string | null,
): CategoryKind {
  if ((REVENUE_CATEGORIES as readonly string[]).includes(slug)) {
    return "income";
  }
  if ((CONTRA_REVENUE_CATEGORIES as readonly string[]).includes(slug)) {
    return "refund";
  }
  if (slug === COST_OF_GOODS_PARENT || parentSlug === COST_OF_GOODS_PARENT) {
    return "cost_of_goods";
  }
  if ((TRANSFER_CATEGORIES as readonly string[]).includes(slug)) {
    return "transfer";
  }
  return "expense";
}
