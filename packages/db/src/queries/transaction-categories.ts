import { type CategoryKind, isProtectedCategory } from "@midday/categories";
import { and, asc, count, desc, eq, isNotNull, isNull, sql } from "drizzle-orm";
import type { Database } from "../client";
import { transactionCategories, transactions } from "../schema";
import { generateCategoryEmbedding } from "../utils/embeddings";
import { createActivity } from "./activities";

export type GetCategoriesParams = {
  teamId: string;
  limit?: number;
};

export type GetCategoryByIdParams = {
  id: string;
  teamId: string;
};

export const getCategories = async (
  db: Database,
  params: GetCategoriesParams,
) => {
  const { teamId, limit = 1000 } = params;

  // First get all parent categories (categories with no parentId)
  const parentCategories = await db
    .select({
      id: transactionCategories.id,
      name: transactionCategories.name,
      color: transactionCategories.color,
      slug: transactionCategories.slug,
      description: transactionCategories.description,
      system: transactionCategories.system,
      taxRate: transactionCategories.taxRate,
      taxType: transactionCategories.taxType,
      taxReportingCode: transactionCategories.taxReportingCode,
      excluded: transactionCategories.excluded,
      parentId: transactionCategories.parentId,
      kind: transactionCategories.kind,
    })
    .from(transactionCategories)
    .where(
      and(
        eq(transactionCategories.teamId, teamId),
        isNull(transactionCategories.parentId),
      ),
    )
    .orderBy(
      desc(transactionCategories.system),
      asc(transactionCategories.name),
    )
    .limit(limit);

  // Then get all child categories for these parents
  const childCategories = await db
    .select({
      id: transactionCategories.id,
      name: transactionCategories.name,
      color: transactionCategories.color,
      slug: transactionCategories.slug,
      description: transactionCategories.description,
      system: transactionCategories.system,
      taxRate: transactionCategories.taxRate,
      taxType: transactionCategories.taxType,
      taxReportingCode: transactionCategories.taxReportingCode,
      excluded: transactionCategories.excluded,
      parentId: transactionCategories.parentId,
      kind: transactionCategories.kind,
    })
    .from(transactionCategories)
    .where(
      and(
        eq(transactionCategories.teamId, teamId),
        isNotNull(transactionCategories.parentId),
      ),
    )
    .orderBy(asc(transactionCategories.name));

  // Group children by parentId for efficient lookup
  const childrenByParentId = new Map<string, typeof childCategories>();
  for (const child of childCategories) {
    if (child.parentId) {
      if (!childrenByParentId.has(child.parentId)) {
        childrenByParentId.set(child.parentId, []);
      }
      childrenByParentId.get(child.parentId)!.push(child);
    }
  }

  // Attach children to their parents
  return parentCategories.map((parent) => ({
    ...parent,
    children: childrenByParentId.get(parent.id) || [],
  }));
};

export const getCategoryById = async (
  db: Database,
  params: GetCategoryByIdParams,
) => {
  const { id, teamId } = params;

  const [result] = await db
    .select({
      id: transactionCategories.id,
      name: transactionCategories.name,
      color: transactionCategories.color,
      slug: transactionCategories.slug,
      description: transactionCategories.description,
      system: transactionCategories.system,
      taxRate: transactionCategories.taxRate,
      taxType: transactionCategories.taxType,
      taxReportingCode: transactionCategories.taxReportingCode,
      excluded: transactionCategories.excluded,
      parentId: transactionCategories.parentId,
      kind: transactionCategories.kind,
      createdAt: transactionCategories.createdAt,
    })
    .from(transactionCategories)
    .where(
      and(
        eq(transactionCategories.id, id),
        eq(transactionCategories.teamId, teamId),
      ),
    )
    .limit(1);

  if (!result) {
    return result;
  }

  // Get children for this category
  const children = await db
    .select({
      id: transactionCategories.id,
      name: transactionCategories.name,
      color: transactionCategories.color,
      slug: transactionCategories.slug,
      description: transactionCategories.description,
      system: transactionCategories.system,
      taxRate: transactionCategories.taxRate,
      taxType: transactionCategories.taxType,
      taxReportingCode: transactionCategories.taxReportingCode,
      excluded: transactionCategories.excluded,
      parentId: transactionCategories.parentId,
      kind: transactionCategories.kind,
    })
    .from(transactionCategories)
    .where(
      and(
        eq(transactionCategories.parentId, id),
        eq(transactionCategories.teamId, teamId),
      ),
    )
    .orderBy(asc(transactionCategories.name));

  return {
    ...result,
    children,
  };
};

export type CreateTransactionCategoryParams = {
  teamId: string;
  userId?: string;
  name: string;
  color?: string | null;
  description?: string | null;
  taxRate?: number | null;
  taxType?: string | null;
  taxReportingCode?: string | null;
  parentId?: string | null;
  /** Defaults to the parent's kind, or "expense" for a top-level category. */
  kind?: CategoryKind;
};

export const createTransactionCategory = async (
  db: Database,
  params: CreateTransactionCategoryParams,
) => {
  const {
    teamId,
    userId,
    name,
    color,
    description,
    taxRate,
    taxType,
    taxReportingCode,
    parentId,
  } = params;

  let kind = params.kind;
  if (!kind && parentId) {
    const [parent] = await db
      .select({ kind: transactionCategories.kind })
      .from(transactionCategories)
      .where(
        and(
          eq(transactionCategories.id, parentId),
          eq(transactionCategories.teamId, teamId),
        ),
      )
      .limit(1);
    kind = parent?.kind;
  }

  const [result] = await db
    .insert(transactionCategories)
    .values({
      teamId,
      name,
      color,
      description,
      taxRate,
      taxType,
      taxReportingCode,
      parentId,
      kind: kind ?? "expense",
    })
    .returning();

  // Create activity for transaction category creation
  if (result) {
    createActivity(db, {
      teamId,
      userId,
      type: "transaction_category_created",
      source: "user",
      priority: 7,
      metadata: {
        categoryId: result.id,
        categoryName: result.name,
        categoryColor: result.color,
        categoryDescription: result.description,
        taxRate: result.taxRate,
        taxType: result.taxType,
        taxReportingCode: result.taxReportingCode,
        parentId: result.parentId,
      },
    });

    // Generate embedding for the new category (async, don't block the response)
    generateCategoryEmbedding(db, {
      name: result.name,
      system: false, // User-created category
    }).catch((error) => {
      console.error(
        `Failed to generate embedding for category "${result.name}":`,
        error,
      );
    });
  }

  return result;
};

export type UpdateTransactionCategoryParams = {
  id: string;
  teamId: string;
  name?: string;
  color?: string | null;
  description?: string | null;
  taxRate?: number | null;
  taxType?: string | null;
  taxReportingCode?: string | null;
  parentId?: string | null;
  kind?: CategoryKind;
};

export const updateTransactionCategory = async (
  db: Database,
  params: UpdateTransactionCategoryParams,
) => {
  const { id, teamId, ...updates } = params;

  // If parentId is being changed, check if the category has children
  if (updates.parentId !== undefined) {
    const childrenCount = await db
      .select({ count: sql<number>`count(*)` })
      .from(transactionCategories)
      .where(
        and(
          eq(transactionCategories.parentId, id),
          eq(transactionCategories.teamId, teamId),
        ),
      );

    if (childrenCount[0]?.count && childrenCount[0].count > 0) {
      throw new Error("Cannot change parent of a category that has children");
    }
  }

  // If name is being updated, get the current category first
  let oldName: string | undefined;
  if (updates.name) {
    const [currentCategory] = await db
      .select({ name: transactionCategories.name })
      .from(transactionCategories)
      .where(
        and(
          eq(transactionCategories.id, id),
          eq(transactionCategories.teamId, teamId),
        ),
      )
      .limit(1);

    oldName = currentCategory?.name;
  }

  const [result] = await db
    .update(transactionCategories)
    .set(updates)
    .where(
      and(
        eq(transactionCategories.id, id),
        eq(transactionCategories.teamId, teamId),
      ),
    )
    .returning();

  // If the name was updated, regenerate the embedding
  if (result && updates.name && oldName && updates.name !== oldName) {
    generateCategoryEmbedding(db, {
      name: updates.name,
      system: result.system || false,
    }).catch((error) => {
      console.error(
        `Failed to update embedding for category "${updates.name}":`,
        error,
      );
    });
  }

  return result;
};

export type DeleteTransactionCategoryParams = {
  id: string;
  teamId: string;
  /**
   * Category the deleted category's transactions move to. Defaults to
   * "uncategorized"; null leaves them without a category.
   */
  replacementSlug?: string | null;
};

export class CategoryDeleteError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "CategoryDeleteError";
  }
}

/**
 * Deletes a category, built-in or custom, except the protected ones. Its
 * transactions move to the replacement category and its subcategories
 * become top-level (parent_id is ON DELETE SET NULL).
 */
export const deleteTransactionCategory = async (
  db: Database,
  params: DeleteTransactionCategoryParams,
) => {
  const { id, teamId } = params;
  const replacementSlug =
    params.replacementSlug === undefined
      ? "uncategorized"
      : params.replacementSlug;

  return db.transaction(async (tx) => {
    const [category] = await tx
      .select({ slug: transactionCategories.slug })
      .from(transactionCategories)
      .where(
        and(
          eq(transactionCategories.id, id),
          eq(transactionCategories.teamId, teamId),
        ),
      )
      .limit(1);

    if (!category) {
      return undefined;
    }

    if (isProtectedCategory(category.slug)) {
      throw new CategoryDeleteError(
        "This category is needed by the app and can't be deleted.",
      );
    }

    const [usage] = await tx
      .select({ count: count() })
      .from(transactions)
      .where(
        and(
          eq(transactions.teamId, teamId),
          eq(transactions.categorySlug, category.slug ?? ""),
        ),
      );

    // Only check the replacement when there are transactions to move.
    if (category.slug && (usage?.count ?? 0) > 0) {
      if (replacementSlug !== null) {
        if (replacementSlug === category.slug) {
          throw new CategoryDeleteError(
            "Pick a different category to move the transactions to.",
          );
        }

        const [replacement] = await tx
          .select({ id: transactionCategories.id })
          .from(transactionCategories)
          .where(
            and(
              eq(transactionCategories.slug, replacementSlug),
              eq(transactionCategories.teamId, teamId),
            ),
          )
          .limit(1);

        if (!replacement) {
          throw new CategoryDeleteError(
            `Category "${replacementSlug}" does not exist.`,
          );
        }
      }

      await tx
        .update(transactions)
        .set({ categorySlug: replacementSlug })
        .where(
          and(
            eq(transactions.teamId, teamId),
            eq(transactions.categorySlug, category.slug),
          ),
        );
    }

    const [result] = await tx
      .delete(transactionCategories)
      .where(
        and(
          eq(transactionCategories.id, id),
          eq(transactionCategories.teamId, teamId),
        ),
      )
      .returning();

    return result;
  });
};

export type GetCategoryUsageParams = {
  id: string;
  teamId: string;
};

/** What deleting a category affects: its transactions and subcategories. */
export const getCategoryUsage = async (
  db: Database,
  params: GetCategoryUsageParams,
) => {
  const { id, teamId } = params;

  const [category] = await db
    .select({ slug: transactionCategories.slug })
    .from(transactionCategories)
    .where(
      and(
        eq(transactionCategories.id, id),
        eq(transactionCategories.teamId, teamId),
      ),
    )
    .limit(1);

  if (!category) {
    return null;
  }

  const [[transactionResult], [childResult]] = await Promise.all([
    db
      .select({ count: count() })
      .from(transactions)
      .where(
        and(
          eq(transactions.teamId, teamId),
          eq(transactions.categorySlug, category.slug ?? ""),
        ),
      ),
    db
      .select({ count: count() })
      .from(transactionCategories)
      .where(
        and(
          eq(transactionCategories.teamId, teamId),
          eq(transactionCategories.parentId, id),
        ),
      ),
  ]);

  return {
    transactionCount: transactionResult?.count ?? 0,
    childCount: childResult?.count ?? 0,
    protected: isProtectedCategory(category.slug),
  };
};

export type CategoryForEnrichment = {
  slug: string;
  name: string;
  description: string | null;
  kind: CategoryKind;
};

/**
 * The team's categories enrichment can choose from: not excluded and without
 * subcategories (the most specific choice).
 */
export const getCategoriesForEnrichment = async (
  db: Database,
  params: { teamId: string },
): Promise<CategoryForEnrichment[]> => {
  const rows = await db
    .select({
      id: transactionCategories.id,
      parentId: transactionCategories.parentId,
      slug: transactionCategories.slug,
      name: transactionCategories.name,
      description: transactionCategories.description,
      kind: transactionCategories.kind,
      excluded: transactionCategories.excluded,
    })
    .from(transactionCategories)
    .where(eq(transactionCategories.teamId, params.teamId))
    .orderBy(asc(transactionCategories.name));

  const parentIds = new Set(rows.map((row) => row.parentId).filter(Boolean));

  return rows
    .filter(
      (row): row is typeof row & { slug: string } =>
        !!row.slug && !row.excluded && !parentIds.has(row.id),
    )
    .map(({ slug, name, description, kind }) => ({
      slug,
      name,
      description,
      kind,
    }));
};
