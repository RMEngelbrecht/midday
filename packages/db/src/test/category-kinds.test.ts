import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import path from "node:path";
import { and, eq, sql } from "drizzle-orm";
import type { Database } from "../client";
import { getRevenue } from "../queries/reports";
import {
  CategoryDeleteError,
  createTransactionCategory,
  deleteTransactionCategory,
  getCategoriesForEnrichment,
  getCategoryUsage,
  updateTransactionCategory,
} from "../queries/transaction-categories";
import { getTransactions, upsertTransactions } from "../queries/transactions";
import { transactionCategories, transactions } from "../schema";
import { seedAll, TEAM_EUR_ID, TEAM_USD_ID } from "./helpers/seed";
import {
  cleanDatabase,
  closeDatabase,
  getTestDatabase,
  isTestDatabaseAvailable,
} from "./helpers/test-database";

const SKIP = !isTestDatabaseAvailable();

// A month the shared seed leaves empty, so totals here come only from the
// transactions these tests insert.
const MONTH = { from: "2031-03-01", to: "2031-03-31" };

let counter = 0;
function tx(
  categorySlug: string | null,
  amount: number,
  teamId = TEAM_USD_ID,
): typeof transactions.$inferInsert {
  counter++;
  return {
    date: "2031-03-15",
    name: `Kinds test ${counter}`,
    method: "payment",
    amount,
    currency: "USD",
    baseAmount: amount,
    baseCurrency: "USD",
    teamId,
    internalId: `kinds-${counter}`,
    status: "posted",
    internal: false,
    categorySlug,
  };
}

async function categoryBySlug(
  db: Database,
  slug: string,
  teamId = TEAM_USD_ID,
) {
  const [row] = await db
    .select()
    .from(transactionCategories)
    .where(
      and(
        eq(transactionCategories.teamId, teamId),
        eq(transactionCategories.slug, slug),
      ),
    );
  return row;
}

async function revenueInMonth(db: Database): Promise<number> {
  const result = await getRevenue(db, {
    teamId: TEAM_USD_ID,
    ...MONTH,
    currency: "USD",
    revenueType: "gross",
  });
  return Number(result[0]?.value ?? 0);
}

describe.skipIf(SKIP)("Category kinds", () => {
  let db: Database;

  beforeAll(async () => {
    db = getTestDatabase();
    await cleanDatabase();
    await seedAll(db);
  });

  afterAll(async () => {
    await closeDatabase();
  });

  test("a custom income category counts as revenue, and stops when its kind changes", async () => {
    const salary = await createTransactionCategory(db, {
      teamId: TEAM_USD_ID,
      name: "Salary Kinds Test",
      kind: "income",
    });
    expect(salary?.kind).toBe("income");

    await db.insert(transactions).values(tx(salary!.slug, 1000));
    expect(await revenueInMonth(db)).toBe(1000);

    await updateTransactionCategory(db, {
      id: salary!.id,
      teamId: TEAM_USD_ID,
      kind: "expense",
    });
    expect(await revenueInMonth(db)).toBe(0);

    // Clean up for the following tests.
    await db
      .delete(transactions)
      .where(eq(transactions.categorySlug, salary!.slug!));
  });

  test("a subcategory takes its parent's kind unless one is given", async () => {
    const revenue = await categoryBySlug(db, "revenue");
    const child = await createTransactionCategory(db, {
      teamId: TEAM_USD_ID,
      name: "Tips Kinds Test",
      parentId: revenue!.id,
    });
    expect(child?.kind).toBe("income");

    const topLevel = await createTransactionCategory(db, {
      teamId: TEAM_USD_ID,
      name: "Hobbies Kinds Test",
    });
    expect(topLevel?.kind).toBe("expense");
  });

  test("the income filter follows kinds; the expense filter keeps uncategorised and drops transfers", async () => {
    const transferCategory = await createTransactionCategory(db, {
      teamId: TEAM_USD_ID,
      name: "Savings Move Kinds Test",
      kind: "transfer",
    });
    const rows = [
      tx("income", 500),
      tx(null, -20),
      tx("office-supplies", -30),
      tx(transferCategory!.slug, -400),
    ];
    await db.insert(transactions).values(rows);

    const income = await getTransactions(db, {
      teamId: TEAM_USD_ID,
      type: "income",
      start: MONTH.from,
      end: MONTH.to,
    });
    expect(income.data.map((row) => row.amount)).toEqual([500]);

    const expenses = await getTransactions(db, {
      teamId: TEAM_USD_ID,
      type: "expense",
      start: MONTH.from,
      end: MONTH.to,
    });
    expect(
      expenses.data.map((row) => row.amount).sort((a, b) => a - b),
    ).toEqual([-30, -20]);
  });

  test("deleting a built-in category moves its transactions to the replacement", async () => {
    const income = await categoryBySlug(db, "income");
    const usage = await getCategoryUsage(db, {
      id: income!.id,
      teamId: TEAM_USD_ID,
    });
    expect(usage?.transactionCount).toBeGreaterThan(0);
    expect(usage?.protected).toBe(false);

    const moved = usage!.transactionCount;
    const before = await db
      .select({ count: sql<number>`count(*)::int` })
      .from(transactions)
      .where(
        and(
          eq(transactions.teamId, TEAM_USD_ID),
          eq(transactions.categorySlug, "consulting-revenue"),
        ),
      );

    const deleted = await deleteTransactionCategory(db, {
      id: income!.id,
      teamId: TEAM_USD_ID,
      replacementSlug: "consulting-revenue",
    });
    expect(deleted?.slug).toBe("income");
    expect(await categoryBySlug(db, "income")).toBeUndefined();

    const after = await db
      .select({ count: sql<number>`count(*)::int` })
      .from(transactions)
      .where(
        and(
          eq(transactions.teamId, TEAM_USD_ID),
          eq(transactions.categorySlug, "consulting-revenue"),
        ),
      );
    expect(after[0]!.count).toBe(before[0]!.count + moved);

    // The other team's "income" category is untouched.
    const eurRevenue = await categoryBySlug(db, "revenue", TEAM_EUR_ID);
    expect(eurRevenue).toBeDefined();
  });

  test("deleting a parent turns its subcategories into top-level categories", async () => {
    const cogs = await categoryBySlug(db, "cost-of-goods-sold");
    await deleteTransactionCategory(db, { id: cogs!.id, teamId: TEAM_USD_ID });

    const materials = await categoryBySlug(db, "materials");
    expect(materials?.parentId).toBeNull();
    expect(materials?.kind).toBe("cost_of_goods");
  });

  test("protected categories and bad replacements are refused", async () => {
    const uncategorized = await createTransactionCategory(db, {
      teamId: TEAM_USD_ID,
      name: "Uncategorized",
    });
    expect(uncategorized?.slug).toBe("uncategorized");

    await expect(
      deleteTransactionCategory(db, {
        id: uncategorized!.id,
        teamId: TEAM_USD_ID,
      }),
    ).rejects.toBeInstanceOf(CategoryDeleteError);

    const software = await categoryBySlug(db, "software");
    await expect(
      deleteTransactionCategory(db, {
        id: software!.id,
        teamId: TEAM_USD_ID,
        replacementSlug: "software",
      }),
    ).rejects.toBeInstanceOf(CategoryDeleteError);
    await expect(
      deleteTransactionCategory(db, {
        id: software!.id,
        teamId: TEAM_USD_ID,
        replacementSlug: "does-not-exist",
      }),
    ).rejects.toBeInstanceOf(CategoryDeleteError);

    // Nothing was deleted by the refused attempts.
    expect(await categoryBySlug(db, "software")).toBeDefined();
  });

  test("synced transactions with a deleted category slug are kept, without a category", async () => {
    // "income" was deleted above; a bank sync still sends it.
    const inserted = await upsertTransactions(db, {
      teamId: TEAM_USD_ID,
      transactions: [
        { ...tx("income", 250), internalId: "kinds-sync-1" },
        { ...tx("software", -15), internalId: "kinds-sync-2" },
      ] as Parameters<typeof upsertTransactions>[1]["transactions"],
    });
    expect(inserted).toHaveLength(2);

    const rows = await db
      .select({
        internalId: transactions.internalId,
        categorySlug: transactions.categorySlug,
      })
      .from(transactions)
      .where(sql`${transactions.internalId} LIKE 'kinds-sync-%'`)
      .orderBy(transactions.internalId);
    expect(rows).toEqual([
      { internalId: "kinds-sync-1", categorySlug: null },
      { internalId: "kinds-sync-2", categorySlug: "software" },
    ]);
  });

  test("enrichment sees the team's own categories, without parents or excluded ones", async () => {
    const categories = await getCategoriesForEnrichment(db, {
      teamId: TEAM_USD_ID,
    });
    const slugs = categories.map((category) => category.slug);

    expect(slugs).toContain("software");
    expect(slugs).toContain("tips-kinds-test");
    expect(slugs).not.toContain("income"); // deleted
    expect(slugs).not.toContain("revenue"); // has a subcategory
  });

  test("migration 0009 gives existing categories the kinds of the old slug lists", async () => {
    const statements = readFileSync(
      path.join(__dirname, "../../migrations/0009_category_kinds.sql"),
      "utf8",
    )
      .split("--> statement-breakpoint")
      .map((statement) => statement.trim())
      .filter((statement) => /^(--.*\n)*UPDATE/m.test(statement));
    expect(statements).toHaveLength(5);

    // Simulate a database from before the migration: everything "expense".
    await db
      .update(transactionCategories)
      .set({ kind: "expense" })
      .where(eq(transactionCategories.teamId, TEAM_EUR_ID));
    const eurRevenue = await categoryBySlug(db, "revenue", TEAM_EUR_ID);
    await db.insert(transactionCategories).values([
      {
        teamId: TEAM_EUR_ID,
        name: "Cost of Goods Sold",
        slug: "cost-of-goods-sold",
        system: true,
      },
      {
        teamId: TEAM_EUR_ID,
        name: "Freelance Kinds Test",
        system: false,
        parentId: eurRevenue!.id,
      },
    ]);

    for (const statement of statements) {
      await db.execute(sql.raw(statement));
    }

    const kinds = Object.fromEntries(
      (
        await db
          .select({
            slug: transactionCategories.slug,
            kind: transactionCategories.kind,
          })
          .from(transactionCategories)
          .where(eq(transactionCategories.teamId, TEAM_EUR_ID))
      ).map((row) => [row.slug, row.kind]),
    );
    expect(kinds).toMatchObject({
      revenue: "income",
      "cost-of-goods-sold": "cost_of_goods",
      "freelance-kinds-test": "income",
      "office-supplies": "expense",
      rent: "expense",
    });
  });
});
