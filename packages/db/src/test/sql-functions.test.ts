/**
 * Runs every SQL function and trigger defined in migrations/0000_extensions
 * and 0002_functions against a migrated database, through the same query
 * helpers the app uses.
 *
 *   docker compose -f docker-compose.test.yml up -d
 *   bun run test:e2e:setup
 *   TEST_DATABASE_URL=postgres://postgres:postgres@localhost:5433/midday_test \
 *     bun test src/test/sql-functions.test.ts
 */
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { and, eq, sql } from "drizzle-orm";
import type { Database } from "../client";
import {
  getBankAccountsBalances,
  getBankAccountsCurrencies,
} from "../queries/bank-accounts";
import { getRelatedDocuments } from "../queries/documents";
import {
  globalSearchQuery,
  globalSemanticSearchQuery,
} from "../queries/search";
import {
  getTrackerProjectById,
  getTrackerProjects,
} from "../queries/tracker-projects";
import {
  authUser,
  bankAccounts,
  bankConnections,
  customers,
  documents,
  exchangeRates,
  inbox,
  invoices,
  teams,
  trackerEntries,
  trackerProjects,
  transactionCategories,
  transactions,
  userInvites,
  users,
  usersOnTeam,
} from "../schema";
import {
  closeDatabase,
  getTestDatabase,
  isTestDatabaseAvailable,
} from "./helpers/test-database";

const SKIP = !isTestDatabaseAvailable();

const USER_ID = "f0000000-0000-4000-8000-000000000001";
const TEAM_ID = "f0000000-0000-4000-8000-000000000002";
const CONNECTION_ID = "f0000000-0000-4000-8000-000000000003";
const ACCOUNT_EUR_ID = "f0000000-0000-4000-8000-000000000004";
const ACCOUNT_USD_ID = "f0000000-0000-4000-8000-000000000005";
const PROJECT_ID = "f0000000-0000-4000-8000-000000000006";
const DOC_A_ID = "f0000000-0000-4000-8000-000000000007";
const DOC_B_ID = "f0000000-0000-4000-8000-000000000008";
const INBOX_ID = "f0000000-0000-4000-8000-000000000009";

async function cleanup(db: Database) {
  await db.delete(teams).where(eq(teams.id, TEAM_ID));
  await db.delete(authUser).where(eq(authUser.id, USER_ID));
}

describe.skipIf(SKIP)("SQL functions on a fresh database", () => {
  let db: Database;

  beforeAll(async () => {
    db = getTestDatabase();
    await cleanup(db);

    // auth.user insert creates public.users via on_auth_user_created.
    await db.insert(authUser).values({
      id: USER_ID,
      name: "Smoke Tester",
      email: "smoke@example.com",
      image: "https://example.com/a.png",
    });

    // teams.inbox_id defaults to generate_inbox(10).
    await db.insert(teams).values({
      id: TEAM_ID,
      name: "Smoke Co",
      baseCurrency: "USD",
    });
    await db
      .update(users)
      .set({ teamId: TEAM_ID })
      .where(eq(users.id, USER_ID));
    await db
      .insert(usersOnTeam)
      .values({ userId: USER_ID, teamId: TEAM_ID, role: "owner" });

    await db
      .insert(exchangeRates)
      .values({ base: "EUR", target: "USD", rate: 1.1 })
      .onConflictDoNothing();

    await db.insert(bankConnections).values({
      id: CONNECTION_ID,
      teamId: TEAM_ID,
      institutionId: "smoke-bank",
      name: "Smoke Bank",
      logoUrl: "https://example.com/bank.png",
      provider: "enablebanking",
    });
    await db.insert(bankAccounts).values([
      {
        id: ACCOUNT_EUR_ID,
        teamId: TEAM_ID,
        createdBy: USER_ID,
        accountId: "eur-1",
        name: "Euro account",
        currency: "EUR",
        balance: 100,
        bankConnectionId: CONNECTION_ID,
      },
      {
        id: ACCOUNT_USD_ID,
        teamId: TEAM_ID,
        createdBy: USER_ID,
        accountId: "usd-1",
        name: "Dollar account",
        currency: "USD",
        balance: 250,
        manual: true,
      },
    ]);

    await db.insert(customers).values({
      teamId: TEAM_ID,
      name: "Acme Corporation",
      email: "billing@acme.test",
    });
    await db.insert(invoices).values({
      teamId: TEAM_ID,
      invoiceNumber: "INV-ACME-1",
      customerName: "Acme Corporation",
      amount: 1500,
      currency: "USD",
      status: "unpaid",
      issueDate: "2026-01-15T00:00:00.000Z",
      dueDate: "2026-02-15T00:00:00.000Z",
    });
    await db.insert(transactions).values({
      teamId: TEAM_ID,
      bankAccountId: ACCOUNT_USD_ID,
      date: "2026-01-20",
      name: "Acme subscription",
      method: "card_purchase",
      amount: -49,
      currency: "USD",
      internalId: `${TEAM_ID}_smoke_1`,
    });

    await db.insert(trackerProjects).values({
      id: PROJECT_ID,
      teamId: TEAM_ID,
      name: "Acme website",
      rate: 100,
      currency: "USD",
    });
    await db.insert(trackerEntries).values([
      {
        teamId: TEAM_ID,
        projectId: PROJECT_ID,
        assignedId: USER_ID,
        duration: 3600,
        date: "2026-01-21",
      },
      {
        teamId: TEAM_ID,
        projectId: PROJECT_ID,
        assignedId: USER_ID,
        duration: 1800,
        date: "2026-01-22",
      },
    ]);

    await db.insert(documents).values([
      {
        id: DOC_A_ID,
        teamId: TEAM_ID,
        name: `${TEAM_ID}/acme-contract-2025.pdf`,
        title: "Acme service contract 2025",
        pathTokens: [TEAM_ID, "acme-contract-2025.pdf"],
      },
      {
        id: DOC_B_ID,
        teamId: TEAM_ID,
        name: `${TEAM_ID}/acme-contract-2026.pdf`,
        title: "Acme service contract 2026",
        pathTokens: [TEAM_ID, "acme-contract-2026.pdf"],
      },
      // No title/body: documents.fts must still be computable.
      {
        teamId: TEAM_ID,
        name: `${TEAM_ID}/untitled.pdf`,
        pathTokens: [TEAM_ID, "untitled.pdf"],
      },
    ]);

    // inbox.fts is generated through generate_inbox_fts/extract_product_names.
    await db.insert(inbox).values({
      id: INBOX_ID,
      teamId: TEAM_ID,
      displayName: "Acme receipt",
      fileName: "acme-receipt.pdf",
      filePath: [TEAM_ID, "inbox", "acme-receipt.pdf"],
      amount: 20,
      currency: "EUR",
      meta: { products: ["Widget", "Gadget"] },
    });
  });

  afterAll(async () => {
    await cleanup(db);
    await closeDatabase();
  });

  test("auth.user insert creates the public.users profile", async () => {
    const [profile] = await db
      .select()
      .from(users)
      .where(eq(users.id, USER_ID));
    expect(profile?.fullName).toBe("Smoke Tester");
    expect(profile?.email).toBe("smoke@example.com");
    expect(profile?.avatarUrl).toBe("https://example.com/a.png");
  });

  test("generate_inbox() fills teams.inbox_id", async () => {
    const [team] = await db.select().from(teams).where(eq(teams.id, TEAM_ID));
    expect(team?.inboxId).toMatch(/^[a-z0-9]{10}$/);
  });

  test("nanoid() fills user_invites.code", async () => {
    const [invite] = await db
      .insert(userInvites)
      .values({ teamId: TEAM_ID, email: "invitee@example.com", role: "member" })
      .returning();
    expect(invite?.code).toMatch(/^[A-Za-z0-9_-]{24}$/);
  });

  test("inbox fts includes product names", async () => {
    const rows = await db.executeOnReplica<{ id: string }>(
      sql`SELECT id FROM inbox WHERE id = ${INBOX_ID} AND fts @@ to_tsquery('english', 'gadget')`,
    );
    expect(rows).toHaveLength(1);
  });

  test("base amount triggers convert bank accounts and inbox", async () => {
    const [eur] = await db
      .select()
      .from(bankAccounts)
      .where(eq(bankAccounts.id, ACCOUNT_EUR_ID));
    expect(eur?.baseBalance).toBeCloseTo(110, 2);
    expect(eur?.baseCurrency).toBe("USD");

    await db
      .update(bankAccounts)
      .set({ balance: 200 })
      .where(eq(bankAccounts.id, ACCOUNT_EUR_ID));
    const [updated] = await db
      .select()
      .from(bankAccounts)
      .where(eq(bankAccounts.id, ACCOUNT_EUR_ID));
    expect(updated?.baseBalance).toBeCloseTo(220, 2);

    const [item] = await db.select().from(inbox).where(eq(inbox.id, INBOX_ID));
    expect(item?.baseAmount).toBeCloseTo(22, 2);
    expect(item?.baseCurrency).toBe("USD");
  });

  test("category slug is generated and deletion uncategorizes transactions", async () => {
    const [category] = await db
      .insert(transactionCategories)
      .values({ teamId: TEAM_ID, name: "Café & Snacks" })
      .returning();
    expect(category?.slug).toBe("cafe-snacks");

    await db
      .update(transactions)
      .set({ categorySlug: "cafe-snacks" })
      .where(eq(transactions.teamId, TEAM_ID));

    await db
      .delete(transactionCategories)
      .where(
        and(
          eq(transactionCategories.teamId, TEAM_ID),
          eq(transactionCategories.slug, "cafe-snacks"),
        ),
      );

    const [tx] = await db
      .select()
      .from(transactions)
      .where(eq(transactions.teamId, TEAM_ID));
    expect(tx?.categorySlug).toBeNull();
  });

  test("get_team_bank_accounts_balances", async () => {
    const result = await getBankAccountsBalances(db, TEAM_ID);
    expect(result).toHaveLength(2);
    const eur = result.find((r) => r.id === ACCOUNT_EUR_ID);
    expect(eur?.name).toBe("Euro account");
    expect(eur?.logo_url).toBe("https://example.com/bank.png");
    expect(Number(result.find((r) => r.id === ACCOUNT_USD_ID)?.balance)).toBe(
      250,
    );
  });

  test("get_bank_account_currencies", async () => {
    const result = await getBankAccountsCurrencies(db, TEAM_ID);
    expect(result.map((r) => r.currency)).toEqual(["EUR", "USD"]);
  });

  test("total_duration / get_project_total_amount / get_assigned_users_for_project", async () => {
    const list = await getTrackerProjects(db, { teamId: TEAM_ID });
    const project = list.data.find((p) => p.id === PROJECT_ID);
    expect(Number(project?.totalDuration)).toBe(5400);
    expect(Number(project?.totalAmount)).toBe(150);
    expect(JSON.stringify(project?.users)).toContain(USER_ID);

    const byId = await getTrackerProjectById(db, {
      teamId: TEAM_ID,
      id: PROJECT_ID,
    });
    expect(Number(byId?.totalDuration)).toBe(5400);
    expect(Number(byId?.totalAmount)).toBe(150);
    expect(JSON.stringify(byId?.users)).toContain(USER_ID);
  });

  test("match_similar_documents_by_title", async () => {
    const related = await getRelatedDocuments(db, {
      id: DOC_A_ID,
      teamId: TEAM_ID,
      pageSize: 5,
    });
    expect(related.map((d) => d.id)).toEqual([DOC_B_ID]);
  });

  test("global_search with a term", async () => {
    const results = await globalSearchQuery(db, {
      teamId: TEAM_ID,
      searchTerm: "acme",
      itemsPerTableLimit: 5,
    });
    const types = new Set(results.map((r) => r.type));
    for (const type of [
      "customer",
      "invoice",
      "transaction",
      "tracker_project",
      "vault",
      "inbox",
    ]) {
      expect(types.has(type)).toBe(true);
    }
    const invoice = results.find((r) => r.type === "invoice");
    expect(invoice?.data.invoice_number).toBe("INV-ACME-1");
    expect(invoice?.data.fts).toBeUndefined();
  });

  test("global_search with an empty term returns recent items", async () => {
    const results = await globalSearchQuery(db, {
      teamId: TEAM_ID,
      searchTerm: "",
      language: "en",
      limit: 30,
      itemsPerTableLimit: 2,
    });
    expect(results.length).toBeGreaterThan(0);
    expect(results.length).toBeLessThanOrEqual(12);
  });

  test("global_semantic_search with filters", async () => {
    const results = await globalSemanticSearchQuery(db, {
      teamId: TEAM_ID,
      searchTerm: "acme",
      itemsPerTableLimit: 5,
      types: ["invoices", "transactions"],
      language: "english",
      startDate: "2026-01-01",
      endDate: "2026-01-31",
      amountMin: 10,
      currency: "usd",
    });
    expect(results.map((r) => r.type).sort()).toEqual([
      "invoice",
      "transaction",
    ]);

    const unpaid = await globalSemanticSearchQuery(db, {
      teamId: TEAM_ID,
      searchTerm: "",
      itemsPerTableLimit: 5,
      types: ["invoices"],
      status: "unpaid",
      dueDateStart: "2026-02-01",
      dueDateEnd: "2026-02-28",
    });
    expect(unpaid).toHaveLength(1);

    const everything = await globalSemanticSearchQuery(db, {
      teamId: TEAM_ID,
      searchTerm: "acme",
      itemsPerTableLimit: 5,
    });
    expect(everything.length).toBeGreaterThanOrEqual(5);
  });
});
