/**
 * Queries backing the worker's bank sync, invoice status and scheduler jobs.
 *
 *   TEST_DATABASE_URL=postgres://postgres:postgres@localhost:5433/midday_test \
 *     bun run test -- src/test/bank-sync.test.ts
 */
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { encrypt } from "@midday/encryption";
import { eq, inArray } from "drizzle-orm";
import type { Database } from "../client";
import {
  countBankConnections,
  getBankAccountsForReconnect,
  getBankAccountsForSync,
  getBankConnectionForSync,
  getInboxAccountIdsForScheduling,
  hasAllBankAccountsFailing,
  markTeamTransactionsNotified,
  updateBankAccountProviderIds,
  updateBankAccountSyncState,
  updateBankConnectionSyncState,
} from "../queries/bank-sync";
import {
  findInvoicePaymentCandidates,
  getInvoiceForStatusCheck,
  getInvoiceIdsForStatusCheck,
} from "../queries/invoice-status";
import { getTeamsForInsights } from "../queries/teams";
import {
  authUser,
  bankAccounts,
  bankConnections,
  inboxAccounts,
  invoices,
  teams,
  transactionAttachments,
  transactions,
  users,
} from "../schema";
import {
  closeDatabase,
  getTestDatabase,
  isTestDatabaseAvailable,
} from "./helpers/test-database";

const SKIP = !isTestDatabaseAvailable();

const USER_ID = "b5000000-0000-4000-8000-000000000001";
const TEAM_ID = "b5000000-0000-4000-8000-000000000002";
const CANCELED_TEAM_ID = "b5000000-0000-4000-8000-000000000003";
const CONNECTION_ID = "b5000000-0000-4000-8000-000000000004";
const ACC_OK = "b5000000-0000-4000-8000-000000000005";
const ACC_FAILING = "b5000000-0000-4000-8000-000000000006";
const ACC_DISABLED = "b5000000-0000-4000-8000-000000000007";
const ACC_MANUAL = "b5000000-0000-4000-8000-000000000008";
const INVOICE_ID = "b5000000-0000-4000-8000-000000000009";
const INBOX_OK = "b5000000-0000-4000-8000-00000000000a";
const INBOX_DISCONNECTED = "b5000000-0000-4000-8000-00000000000b";
const TX_MATCH = "b5000000-0000-4000-8000-00000000000c";
const TX_ATTACHED = "b5000000-0000-4000-8000-00000000000d";

async function cleanup(db: Database) {
  await db.delete(teams).where(inArray(teams.id, [TEAM_ID, CANCELED_TEAM_ID]));
  await db.delete(authUser).where(eq(authUser.id, USER_ID));
}

function tx(id: string, overrides: Partial<typeof transactions.$inferInsert>) {
  return {
    id,
    teamId: TEAM_ID,
    bankAccountId: ACC_OK,
    internalId: `${TEAM_ID}_${id}`,
    name: "Payment",
    date: new Date().toISOString().slice(0, 10),
    amount: 500,
    currency: "USD",
    method: "transfer" as const,
    status: "posted" as const,
    ...overrides,
  };
}

describe.skipIf(SKIP)("bank sync queries", () => {
  let db: Database;

  beforeAll(async () => {
    db = getTestDatabase();
    await cleanup(db);

    await db.insert(authUser).values({
      id: USER_ID,
      name: "Sync Tester",
      email: "sync@example.com",
    });
    await db.insert(teams).values([
      { id: TEAM_ID, name: "Sync Co", baseCurrency: "USD" },
      {
        id: CANCELED_TEAM_ID,
        name: "Leaving Co",
        baseCurrency: "USD",
        canceledAt: new Date().toISOString(),
      },
    ]);
    await db
      .update(users)
      .set({ teamId: TEAM_ID })
      .where(eq(users.id, USER_ID));

    await db.insert(bankConnections).values({
      id: CONNECTION_ID,
      teamId: TEAM_ID,
      institutionId: "sync-bank",
      name: "Sync Bank",
      provider: "plaid",
      accessToken: "access-token",
      status: "unknown",
    });

    const base = {
      teamId: TEAM_ID,
      createdBy: USER_ID,
      bankConnectionId: CONNECTION_ID,
      currency: "USD",
    };
    await db.insert(bankAccounts).values([
      {
        ...base,
        id: ACC_OK,
        accountId: "ok",
        name: "Checking",
        type: "depository",
        errorRetries: 1,
        iban: encrypt("DE89370400440532013000"),
        accountReference: "ref-ok",
      },
      { ...base, id: ACC_FAILING, accountId: "failing", errorRetries: 5 },
      { ...base, id: ACC_DISABLED, accountId: "disabled", enabled: false },
      {
        ...base,
        id: ACC_MANUAL,
        accountId: "manual",
        manual: true,
        bankConnectionId: null,
      },
    ]);
  });

  afterAll(async () => {
    await cleanup(db);
    await closeDatabase();
  });

  test("getBankConnectionForSync returns provider credentials", async () => {
    const connection = await getBankConnectionForSync(db, {
      id: CONNECTION_ID,
    });
    expect(connection).toMatchObject({
      teamId: TEAM_ID,
      provider: "plaid",
      accessToken: "access-token",
    });
    expect(
      await getBankConnectionForSync(db, {
        id: "b5000000-0000-4000-8000-0000000000ff",
      }),
    ).toBeNull();
  });

  test("getBankAccountsForSync skips repeatedly failing accounts on background syncs", async () => {
    const background = await getBankAccountsForSync(db, {
      connectionId: CONNECTION_ID,
    });
    expect(background.map((a) => a.id)).toEqual([ACC_OK]);

    const manual = await getBankAccountsForSync(db, {
      connectionId: CONNECTION_ID,
      manualSync: true,
    });
    expect(manual.map((a) => a.id).sort()).toEqual(
      [ACC_OK, ACC_FAILING].sort(),
    );
  });

  test("hasAllBankAccountsFailing only when every enabled account failed 3+ times", async () => {
    expect(
      await hasAllBankAccountsFailing(db, { connectionId: CONNECTION_ID }),
    ).toBe(false);

    await updateBankAccountSyncState(db, { id: ACC_OK, errorRetries: 3 });
    expect(
      await hasAllBankAccountsFailing(db, { connectionId: CONNECTION_ID }),
    ).toBe(true);

    await updateBankAccountSyncState(db, {
      id: ACC_OK,
      balance: 42,
      errorRetries: null,
      errorDetails: null,
    });
    const [row] = await db
      .select()
      .from(bankAccounts)
      .where(eq(bankAccounts.id, ACC_OK));
    expect(row?.balance).toBe(42);
    expect(row?.errorRetries).toBeNull();
  });

  test("hasAllBankAccountsFailing is false for a connection without accounts", async () => {
    expect(
      await hasAllBankAccountsFailing(db, {
        connectionId: "b5000000-0000-4000-8000-0000000000fe",
      }),
    ).toBe(false);
  });

  test("updateBankConnectionSyncState sets status and last accessed", async () => {
    const now = new Date().toISOString();
    await updateBankConnectionSyncState(db, {
      id: CONNECTION_ID,
      status: "connected",
      lastAccessed: now,
    });
    const connection = await getBankConnectionForSync(db, {
      id: CONNECTION_ID,
    });
    expect(connection?.status).toBe("connected");
  });

  test("reconnect accounts expose decrypted IBAN and provider ids round-trip encrypted", async () => {
    const accounts = await getBankAccountsForReconnect(db, {
      connectionId: CONNECTION_ID,
      teamId: TEAM_ID,
    });
    const ok = accounts.find((a) => a.id === ACC_OK);
    expect(ok?.iban).toBe("DE89370400440532013000");

    await updateBankAccountProviderIds(db, {
      id: ACC_OK,
      accountId: "ok-v2",
      accountReference: "ref-v2",
      iban: "GB33BUKB20201555555555",
    });
    const [raw] = await db
      .select()
      .from(bankAccounts)
      .where(eq(bankAccounts.id, ACC_OK));
    expect(raw?.accountId).toBe("ok-v2");
    expect(raw?.iban).not.toBe("GB33BUKB20201555555555");

    const after = await getBankAccountsForReconnect(db, {
      connectionId: CONNECTION_ID,
      teamId: TEAM_ID,
    });
    expect(after.find((a) => a.id === ACC_OK)?.iban).toBe(
      "GB33BUKB20201555555555",
    );
  });

  test("countBankConnections counts per team", async () => {
    expect(await countBankConnections(db, { teamId: TEAM_ID })).toBe(1);
    expect(await countBankConnections(db, { teamId: CANCELED_TEAM_ID })).toBe(
      0,
    );
  });

  test("markTeamTransactionsNotified flips and returns newest first", async () => {
    await db
      .insert(transactions)
      .values([
        tx(TX_MATCH, { date: "2026-01-02", notified: false }),
        tx(TX_ATTACHED, { date: "2026-01-05", notified: false, amount: 10 }),
      ]);

    const first = await markTeamTransactionsNotified(db, { teamId: TEAM_ID });
    expect(first.map((t) => t.id)).toEqual([TX_ATTACHED, TX_MATCH]);

    const second = await markTeamTransactionsNotified(db, { teamId: TEAM_ID });
    expect(second).toEqual([]);
  });

  test("invoice payment candidates exclude fulfilled and older transactions", async () => {
    await db.insert(invoices).values({
      id: INVOICE_ID,
      teamId: TEAM_ID,
      invoiceNumber: "INV-1",
      status: "unpaid",
      amount: 500,
      currency: "usd",
      dueDate: "2026-01-01T00:00:00.000Z",
      customerName: "Acme",
    });

    const ids = await getInvoiceIdsForStatusCheck(db);
    expect(ids.map((i) => i.id)).toContain(INVOICE_ID);

    const invoice = await getInvoiceForStatusCheck(db, { id: INVOICE_ID });
    expect(invoice).toMatchObject({ amount: 500, customerName: "Acme" });

    await db
      .update(transactions)
      .set({ amount: 500 })
      .where(eq(transactions.id, TX_ATTACHED));
    await db.insert(transactionAttachments).values({
      teamId: TEAM_ID,
      transactionId: TX_ATTACHED,
      name: "receipt.pdf",
      path: ["x"],
      type: "application/pdf",
      size: 1,
    });

    const candidates = await findInvoicePaymentCandidates(db, {
      teamId: TEAM_ID,
      amount: 500,
      currency: "usd",
      since: "2026-01-01",
    });
    expect(candidates.map((c) => c.id)).toEqual([TX_MATCH]);

    expect(
      await findInvoicePaymentCandidates(db, {
        teamId: TEAM_ID,
        amount: 500,
        currency: "USD",
        since: "2026-01-03",
      }),
    ).toEqual([]);
  });

  test("inbox accounts for scheduling exclude disconnected accounts", async () => {
    const common = {
      teamId: TEAM_ID,
      provider: "gmail" as const,
      accessToken: "a",
      refreshToken: "r",
      expiryDate: new Date().toISOString(),
      lastAccessed: new Date().toISOString(),
    };
    await db.insert(inboxAccounts).values([
      { ...common, id: INBOX_OK, email: "ok@example.com", externalId: "1" },
      {
        ...common,
        id: INBOX_DISCONNECTED,
        email: "gone@example.com",
        externalId: "2",
        status: "disconnected",
      },
    ]);

    const ids = (await getInboxAccountIdsForScheduling(db)).map((a) => a.id);
    expect(ids).toContain(INBOX_OK);
    expect(ids).not.toContain(INBOX_DISCONNECTED);
  });

  test("getTeamsForInsights skips teams scheduled for deletion", async () => {
    const eligible = await getTeamsForInsights(db, {
      enabledTeamIds: [TEAM_ID, CANCELED_TEAM_ID],
    });
    const ids = eligible.map((t) => t.id);
    expect(ids).toContain(TEAM_ID);
    expect(ids).not.toContain(CANCELED_TEAM_ID);
  });
});
