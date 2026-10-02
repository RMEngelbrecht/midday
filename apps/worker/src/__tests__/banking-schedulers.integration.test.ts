/**
 * End-to-end: bank setup → scheduler → sync → delete → reconcile, plus the
 * onboarding/invite email jobs, against a real Postgres and Valkey/Redis.
 * The banking provider and the email sender are swapped for fakes.
 *
 *   TEST_DATABASE_URL=postgres://postgres:postgres@localhost:5443/midday_test \
 *   DATABASE_URL=$TEST_DATABASE_URL REDIS_URL=redis://localhost:6443 \
 *   APP_ENV=test varlock run -- bun test src/__tests__/banking-schedulers.integration.test.ts
 *
 * Skipped unless TEST_DATABASE_URL is set. Obliterates the banking and teams
 * queues, so only point it at a throwaway Redis.
 */
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import type { Transaction } from "@midday/banking";
import {
  authUser,
  bankAccounts,
  bankConnections,
  teams,
  transactions,
  users,
} from "@midday/db/schema";
import { triggerJob } from "@midday/job-client";
import { type Job, type Queue, Worker } from "bullmq";
import { eq, inArray } from "drizzle-orm";
import { getRedisConnection } from "../config";
import { ENV } from "../env";
import { bankingProcessors } from "../processors/banking";
import { teamProcessors } from "../processors/teams";
import { bankingQueue } from "../queues/banking";
import { teamsQueue } from "../queues/teams";
import {
  bankSyncScheduler,
  getSchedulerId,
  listDynamicSchedulerKeys,
  upsertDynamicScheduler,
} from "../schedulers/dynamic";
import { setBankingClientFactory } from "../utils/banking-client";
import { getDb } from "../utils/db";
import { generateCronTag } from "../utils/generate-cron-tag";
import { type OutgoingEmail, setEmailSender } from "../utils/mailer";

const SKIP = !ENV.TEST_DATABASE_URL;

const USER_ID = "c3000000-0000-4000-8000-000000000001";
const TEAM_ID = "c3000000-0000-4000-8000-000000000002";
const TEAM_2_ID = "c3000000-0000-4000-8000-000000000003";
const CONNECTION_ID = "c3000000-0000-4000-8000-000000000004";
const CONNECTION_2_ID = "c3000000-0000-4000-8000-000000000005";
const ACCOUNT_ID = "c3000000-0000-4000-8000-000000000006";
const MANUAL_ACCOUNT_ID = "c3000000-0000-4000-8000-000000000007";
const ORPHAN_TEAM_ID = "c3000000-0000-4000-8000-0000000000ff";

function providerTx(id: string, amount: number): Transaction {
  return {
    id,
    amount,
    currency: "USD",
    date: "2026-09-01",
    status: "posted",
    balance: null,
    category: null,
    counterparty_name: null,
    merchant_name: null,
    method: "card_purchase",
    name: `Purchase ${id}`,
    description: null,
    currency_rate: null,
    currency_source: null,
  };
}

const fakeProvider = {
  transactions: [providerTx("tx-1", -10), providerTx("tx-2", -20)],
  deleted: [] as string[],
};

const sentEmails: OutgoingEmail[] = [];

async function waitFor<T>(
  check: () => Promise<T | undefined | null | false>,
  timeoutMs = 20_000,
): Promise<T> {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    const value = await check();
    if (value) return value;
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error("Timed out waiting for condition");
}

async function waitForJob(queue: Queue, compositeId: string) {
  const jobId = compositeId.slice(compositeId.indexOf(":") + 1);
  return waitFor(async () => {
    const job = await queue.getJob(jobId);
    const state = await job?.getState();
    if (state === "failed") {
      throw new Error(`Job ${compositeId} failed: ${job?.failedReason}`);
    }
    return state === "completed" ? job : null;
  });
}

async function teamTransactionCount(teamId: string) {
  const rows = await getDb()
    .select({ id: transactions.id })
    .from(transactions)
    .where(eq(transactions.teamId, teamId));
  return rows.length;
}

async function cleanup() {
  const db = getDb();
  await db.delete(teams).where(inArray(teams.id, [TEAM_ID, TEAM_2_ID]));
  await db.delete(authUser).where(eq(authUser.id, USER_ID));
}

describe.skipIf(SKIP)("banking + onboarding jobs (integration)", () => {
  const workers: Worker[] = [];

  beforeAll(async () => {
    await bankingQueue.obliterate({ force: true });
    await teamsQueue.obliterate({ force: true });
    await cleanup();

    setBankingClientFactory(() => ({
      getConnectionStatus: async () => ({ status: "connected" }),
      getAccounts: async () => [],
      getAccountBalance: async () => ({
        amount: 1234.5,
        currency: "USD",
        available_balance: null,
        credit_limit: null,
      }),
      getTransactions: async () => fakeProvider.transactions,
      deleteConnection: async ({ id }) => {
        fakeProvider.deleted.push(id);
      },
    }));
    setEmailSender(async (email) => {
      sentEmails.push(email);
    });

    const db = getDb();
    await db.insert(authUser).values({
      id: USER_ID,
      name: "Ada Lovelace",
      email: "ada@example.com",
    });
    await db.insert(teams).values([
      { id: TEAM_ID, name: "Analytical Engines" },
      { id: TEAM_2_ID, name: "Difference Engines" },
    ]);
    await db
      .update(users)
      .set({ teamId: TEAM_ID, fullName: "Ada Lovelace" })
      .where(eq(users.id, USER_ID));
    await db.insert(bankConnections).values({
      id: CONNECTION_ID,
      teamId: TEAM_ID,
      institutionId: "fake-bank",
      name: "Fake Bank",
      provider: "plaid",
      accessToken: "access-sandbox",
      referenceId: "item-1",
    });
    await db.insert(bankAccounts).values([
      {
        id: ACCOUNT_ID,
        teamId: TEAM_ID,
        createdBy: USER_ID,
        bankConnectionId: CONNECTION_ID,
        accountId: "acc-1",
        name: "Checking",
        currency: "USD",
        type: "depository",
      },
      {
        id: MANUAL_ACCOUNT_ID,
        teamId: TEAM_ID,
        createdBy: USER_ID,
        accountId: "manual-1",
        name: "Cash",
        currency: "USD",
        manual: true,
      },
    ]);

    const processors: Record<string, { handle: (job: Job) => unknown }> = {
      ...bankingProcessors,
      ...teamProcessors,
    };
    for (const name of ["banking", "teams"]) {
      workers.push(
        new Worker(
          name,
          async (job: Job) => processors[job.name]!.handle(job),
          {
            connection: getRedisConnection(),
            concurrency: 5,
          },
        ),
      );
    }
  });

  afterAll(async () => {
    await Promise.all(workers.map((worker) => worker.close()));
    setBankingClientFactory();
    setEmailSender();
    await bankingQueue.obliterate({ force: true });
    await teamsQueue.obliterate({ force: true });
    await cleanup();
  });

  test("initial setup creates the team scheduler and imports transactions", async () => {
    const job = await triggerJob(
      "initial-bank-setup",
      { teamId: TEAM_ID, connectionId: CONNECTION_ID },
      "banking",
    );
    const done = await waitForJob(bankingQueue, job.id);

    expect(done.returnvalue).toMatchObject({
      status: "connected",
      accounts: 1,
      transactionsInserted: 2,
    });

    const [scheduler] = (await bankingQueue.getJobSchedulers()).filter(
      (s) => s.key === getSchedulerId(bankSyncScheduler, TEAM_ID),
    );
    expect(scheduler?.pattern).toBe(generateCronTag(TEAM_ID));
    expect(scheduler?.name).toBe("bank-sync-scheduler");

    expect(await teamTransactionCount(TEAM_ID)).toBe(2);
    const [account] = await getDb()
      .select()
      .from(bankAccounts)
      .where(eq(bankAccounts.id, ACCOUNT_ID));
    expect(account?.balance).toBe(1234.5);
  });

  test("the scheduler fires a background sync that upserts new transactions", async () => {
    fakeProvider.transactions = [
      ...fakeProvider.transactions,
      providerTx("tx-3", -30),
    ];

    // Same scheduler id and template, but firing every second
    await upsertDynamicScheduler(bankSyncScheduler, TEAM_ID, { every: 1000 });

    await waitFor(async () => (await teamTransactionCount(TEAM_ID)) === 3);

    // Back to the daily pattern
    await upsertDynamicScheduler(bankSyncScheduler, TEAM_ID);

    const [row] = await getDb()
      .select({ notified: transactions.notified })
      .from(transactions)
      .where(eq(transactions.internalId, `${TEAM_ID}_tx-3`));
    // Background syncs leave new rows unnotified for the batched notification
    expect(row?.notified).toBe(false);
  });

  test("deleting the last connection removes the team scheduler", async () => {
    // The API deletes the row, then enqueues provider cleanup
    await getDb()
      .delete(bankConnections)
      .where(eq(bankConnections.id, CONNECTION_ID));

    const job = await triggerJob(
      "delete-connection",
      {
        teamId: TEAM_ID,
        referenceId: "item-1",
        provider: "plaid",
        accessToken: "access-sandbox",
      },
      "banking",
    );
    const done = await waitForJob(bankingQueue, job.id);

    expect(done.returnvalue).toEqual({ schedulerRemoved: true });
    expect(fakeProvider.deleted).toContain("item-1");
    expect(await listDynamicSchedulerKeys(bankSyncScheduler)).not.toContain(
      TEAM_ID,
    );
  });

  test("reconcile creates missing schedulers and removes orphans", async () => {
    await getDb().insert(bankConnections).values({
      id: CONNECTION_2_ID,
      teamId: TEAM_2_ID,
      institutionId: "fake-bank",
      name: "Fake Bank",
      provider: "plaid",
      accessToken: "access-2",
    });
    await upsertDynamicScheduler(bankSyncScheduler, ORPHAN_TEAM_ID);

    const job = await triggerJob("ensure-bank-schedulers", {}, "banking");
    await waitForJob(bankingQueue, job.id);

    const keys = await listDynamicSchedulerKeys(bankSyncScheduler);
    expect(keys).toContain(TEAM_2_ID);
    expect(keys).not.toContain(ORPHAN_TEAM_ID);
    expect(keys).not.toContain(TEAM_ID);
  });

  test("onboard-team schedules the welcome and activation emails", async () => {
    sentEmails.length = 0;

    const job = await triggerJob("onboard-team", { userId: USER_ID }, "teams");
    await waitForJob(teamsQueue, job.id);

    const welcome = await teamsQueue.getJob(`onboarding-welcome-${USER_ID}`);
    const activation = await teamsQueue.getJob(
      `onboarding-activation-${USER_ID}`,
    );
    expect(await welcome?.getState()).toBe("delayed");
    expect(welcome?.opts.delay).toBe(10 * 60_000);
    expect(activation?.opts.delay).toBe(3 * 24 * 60 * 60_000);

    // Fast-forward the delays
    await welcome!.promote();
    await activation!.promote();
    await waitForJob(teamsQueue, `teams:${welcome!.id}`);
    await waitForJob(teamsQueue, `teams:${activation!.id}`);

    expect(sentEmails.map((e) => [e.to, e.subject])).toEqual(
      expect.arrayContaining([
        ["ada@example.com", "Welcome to Midday"],
        // The team has no bank connection left, so it gets the nudge
        ["ada@example.com", "Connect your bank to see the full picture"],
      ]),
    );
  });

  test("invite-team-members sends one email per invite", async () => {
    sentEmails.length = 0;

    const job = await triggerJob(
      "invite-team-members",
      {
        teamId: TEAM_ID,
        ip: "127.0.0.1",
        locale: "en",
        invites: ["grace@example.com", "alan@example.com"].map((email) => ({
          email,
          invitedByName: "Ada Lovelace",
          invitedByEmail: "ada@example.com",
          teamName: "Analytical Engines",
        })),
      },
      "teams",
    );
    await waitForJob(teamsQueue, job.id);

    expect(sentEmails.map((e) => e.to).sort()).toEqual([
      "alan@example.com",
      "grace@example.com",
    ]);
  });
});
