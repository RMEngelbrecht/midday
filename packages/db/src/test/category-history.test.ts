import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { format, subMonths } from "date-fns";
import { and, eq, like } from "drizzle-orm";
import type { Database } from "../client";
import {
  applyCategoryHistory,
  getCategoryHistory,
} from "../queries/transaction-enrichment";
import { getSimilarTransactions } from "../queries/transactions";
import { transactionCategories, transactions } from "../schema";
import {
  CategoryHistory,
  type CategoryHistoryEntry,
} from "../utils/category-history";
import { seedAll, TEAM_EUR_ID } from "./helpers/seed";
import {
  cleanDatabase,
  closeDatabase,
  getTestDatabase,
  isTestDatabaseAvailable,
} from "./helpers/test-database";

function entry(
  fields: Partial<CategoryHistoryEntry> & Pick<CategoryHistoryEntry, "name">,
): CategoryHistoryEntry {
  return {
    merchantName: null,
    counterpartyName: null,
    categorySlug: "software",
    incoming: false,
    count: 1,
    ...fields,
  };
}

function pending(
  name: string,
  amount = -10,
  counterpartyName: string | null = null,
  merchantName: string | null = null,
) {
  return { name, amount, counterpartyName, merchantName };
}

describe("CategoryHistory", () => {
  test("repeats the category of a known counterparty", () => {
    const history = new CategoryHistory([
      entry({
        name: "Sepa Overschrijving",
        counterpartyName: "Fluitshop B.V.",
        categorySlug: "equipment",
        count: 4,
      }),
    ]);

    expect(
      history.suggest(pending("Naam Fluitshop 123", -50, "FLUITSHOP BV")),
    ).toEqual({ categorySlug: "equipment", matches: 4 });
  });

  test("matches names with different store numbers", () => {
    const history = new CategoryHistory([
      entry({ name: "Albert Heijn 1234", categorySlug: "meals" }),
    ]);
    expect(history.suggest(pending("Albert Heijn 5678"))?.categorySlug).toBe(
      "meals",
    );
  });

  test("unknown vendors get nothing", () => {
    const history = new CategoryHistory([
      entry({ name: "Albert Heijn 1234", categorySlug: "meals" }),
    ]);
    expect(history.suggest(pending("Jumbo Supermarkt"))).toBeNull();
  });

  test("a split history is left to the AI", () => {
    const history = new CategoryHistory([
      entry({
        name: "PayPal Europe",
        counterpartyName: "PayPal Europe",
        categorySlug: "software",
        count: 3,
      }),
      entry({
        name: "PayPal Europe",
        counterpartyName: "PayPal Europe",
        categorySlug: "office-supplies",
        count: 2,
      }),
    ]);
    expect(
      history.suggest(pending("PayPal Europe", -20, "PayPal Europe")),
    ).toBeNull();
  });

  test("a clear majority wins", () => {
    const history = new CategoryHistory([
      entry({ name: "Figma", categorySlug: "software", count: 9 }),
      entry({ name: "Figma", categorySlug: "office-supplies", count: 1 }),
    ]);
    expect(history.suggest(pending("Figma"))).toEqual({
      categorySlug: "software",
      matches: 9,
    });
  });

  test("the merchant separates shops behind one counterparty", () => {
    const history = new CategoryHistory([
      entry({
        name: "PayPal Europe",
        counterpartyName: "PayPal Europe",
        merchantName: "Bol.com B.V.",
        categorySlug: "office-supplies",
      }),
      entry({
        name: "PayPal Europe",
        counterpartyName: "PayPal Europe",
        merchantName: "Spotify AB",
        categorySlug: "software",
      }),
    ]);
    expect(
      history.suggest(pending("PayPal Europe", -20, "PayPal Europe", "bol.com"))
        ?.categorySlug,
    ).toBe("office-supplies");
  });

  test("money in and money out are kept apart", () => {
    const history = new CategoryHistory([
      entry({
        name: "Acme Corp",
        categorySlug: "consulting-revenue",
        incoming: true,
      }),
    ]);
    expect(history.suggest(pending("Acme Corp", 1500))?.categorySlug).toBe(
      "consulting-revenue",
    );
    expect(history.suggest(pending("Acme Corp", -15))).toBeNull();
  });

  test("a bank label shared by many counterparties does not match by name", () => {
    const history = new CategoryHistory([
      entry({
        name: "Sepa Overschrijving",
        counterpartyName: "Fluitshop",
        categorySlug: "equipment",
      }),
      entry({
        name: "Sepa Overschrijving",
        counterpartyName: "Albert Heijn",
        categorySlug: "meals",
      }),
    ]);
    expect(history.suggest(pending("Sepa Overschrijving"))).toBeNull();
  });
});

const SKIP = !isTestDatabaseAvailable();

describe.skipIf(SKIP)("getCategoryHistory", () => {
  let db: Database;

  beforeAll(async () => {
    db = getTestDatabase();
    await cleanDatabase();
    await seedAll(db);
  });

  afterAll(async () => {
    await closeDatabase();
  });

  test("groups recent categorised transactions by vendor, category and direction", async () => {
    const recent = format(subMonths(new Date(), 1), "yyyy-MM-dd");
    const old = format(subMonths(new Date(), 30), "yyyy-MM-dd");
    const base = {
      method: "payment" as const,
      currency: "EUR",
      teamId: TEAM_EUR_ID,
      status: "posted" as const,
      counterpartyName: "History Test Vendor",
    };
    await db.insert(transactionCategories).values({
      teamId: TEAM_EUR_ID,
      name: "Uncategorized",
      slug: "uncategorized",
    });
    await db.insert(transactions).values([
      {
        ...base,
        date: recent,
        name: "History Test Vendor",
        amount: -10,
        internalId: "hist-1",
        categorySlug: "software",
      },
      {
        ...base,
        date: recent,
        name: "History Test Vendor",
        amount: -12,
        internalId: "hist-2",
        categorySlug: "software",
      },
      {
        ...base,
        date: recent,
        name: "History Test Vendor",
        amount: 5,
        internalId: "hist-3",
        categorySlug: "software",
      },
      {
        ...base,
        date: recent,
        name: "History Test Vendor",
        amount: -1,
        internalId: "hist-4",
        categorySlug: "uncategorized",
      },
      {
        ...base,
        date: recent,
        name: "History Test Vendor",
        amount: -1,
        internalId: "hist-5",
        categorySlug: null,
      },
      {
        ...base,
        date: old,
        name: "History Test Vendor",
        amount: -1,
        internalId: "hist-6",
        categorySlug: "rent",
      },
    ]);

    const history = await getCategoryHistory(db, { teamId: TEAM_EUR_ID });
    const rows = history
      .filter((row) => row.counterpartyName === "History Test Vendor")
      .map(({ categorySlug, incoming, count }) => ({
        categorySlug,
        incoming,
        count,
      }))
      .sort((a, b) => b.count - a.count);

    expect(rows).toEqual([
      { categorySlug: "software", incoming: false, count: 2 },
      { categorySlug: "software", incoming: true, count: 1 },
    ]);
  });

  test("similar transactions only offer the same direction", async () => {
    const recent = format(subMonths(new Date(), 1), "yyyy-MM-dd");
    const base = {
      date: recent,
      method: "payment" as const,
      currency: "EUR",
      teamId: TEAM_EUR_ID,
      status: "posted" as const,
      counterpartyName: "Apple",
    };
    const [bill, , topUp] = await db
      .insert(transactions)
      .values([
        { ...base, name: "Apple Com Bill", amount: -2.99, internalId: "sim-1" },
        { ...base, name: "Apple Com Bill", amount: 0, internalId: "sim-2" },
        {
          ...base,
          name: "Apple Pay Top Up By 5184",
          amount: 10,
          internalId: "sim-3",
        },
        {
          ...base,
          name: "Apple Pay Top Up By 5184",
          amount: 10,
          internalId: "sim-4",
        },
      ])
      .returning({ id: transactions.id, internalId: transactions.internalId });

    const fromBill = await getSimilarTransactions(db, {
      teamId: TEAM_EUR_ID,
      transactionId: bill!.id,
      name: "Apple Com Bill",
    });
    expect(fromBill.map((row) => row.amount)).toEqual([0]);

    const fromTopUp = await getSimilarTransactions(db, {
      teamId: TEAM_EUR_ID,
      transactionId: topUp!.id,
      name: "Apple Pay Top Up By 5184",
    });
    expect(fromTopUp.map((row) => row.amount)).toEqual([10]);
  });

  test("fill from history categorises only uncategorised transactions of known vendors", async () => {
    const recent = format(subMonths(new Date(), 1), "yyyy-MM-dd");
    const base = {
      date: recent,
      method: "payment" as const,
      currency: "EUR",
      teamId: TEAM_EUR_ID,
      status: "posted" as const,
    };
    await db.insert(transactions).values([
      // History: two Backfill Cloud payments in software.
      {
        ...base,
        name: "Backfill Cloud 1",
        amount: -5,
        internalId: "fill-1",
        categorySlug: "software",
      },
      {
        ...base,
        name: "Backfill Cloud 2",
        amount: -5,
        internalId: "fill-2",
        categorySlug: "software",
      },
      // Filled: no category, and Uncategorized.
      {
        ...base,
        name: "Backfill Cloud 3",
        amount: -5,
        internalId: "fill-3",
        categorySlug: null,
      },
      {
        ...base,
        name: "Backfill Cloud 4",
        amount: -5,
        internalId: "fill-4",
        categorySlug: "uncategorized",
      },
      // Left alone: a real category, money in, an unknown vendor.
      // ("Backfill Rent" is its own vendor; the same vendor in rent would
      // split the history and nothing would be filled.)
      {
        ...base,
        name: "Backfill Rent",
        amount: -5,
        internalId: "fill-5",
        categorySlug: "rent",
      },
      {
        ...base,
        name: "Backfill Cloud 6",
        amount: 5,
        internalId: "fill-6",
        categorySlug: null,
      },
      {
        ...base,
        name: "Backfill Unknown",
        amount: -5,
        internalId: "fill-7",
        categorySlug: null,
      },
    ]);

    // 2 here, plus the uncategorised History Test Vendor rows from the
    // getCategoryHistory test.
    expect(
      await applyCategoryHistory(db, { teamId: TEAM_EUR_ID, dryRun: true }),
    ).toEqual({ count: 4 });
    const unchanged = await db
      .select({ categorySlug: transactions.categorySlug })
      .from(transactions)
      .where(eq(transactions.internalId, "fill-3"));
    expect(unchanged[0]?.categorySlug).toBeNull();

    expect(await applyCategoryHistory(db, { teamId: TEAM_EUR_ID })).toEqual({
      count: 4,
    });

    const rows = await db
      .select({
        internalId: transactions.internalId,
        categorySlug: transactions.categorySlug,
      })
      .from(transactions)
      .where(
        and(
          eq(transactions.teamId, TEAM_EUR_ID),
          like(transactions.internalId, "fill-%"),
        ),
      )
      .orderBy(transactions.internalId);
    expect(rows.map((row) => row.categorySlug)).toEqual([
      "software",
      "software",
      "software",
      "software",
      "rent",
      null,
      null,
    ]);
  });
});
